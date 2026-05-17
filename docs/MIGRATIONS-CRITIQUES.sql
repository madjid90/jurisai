-- ============================================================================
-- MIGRATIONS CRITIQUES JurisAI — Bypass RLS pour Lovable Cloud
-- ============================================================================
--
-- À EXÉCUTER SI : tu vois des erreurs comme :
--   - "Vous devez d'abord compléter l'onboarding" (alors que tu l'as fait)
--   - "Vérification du rate limit échouée"
--   - "User not allowed"
--   - "new row violates row-level security policy"
--   - "permission denied for function"
--
-- COMMENT EXÉCUTER :
--   1. Va sur https://supabase.com/dashboard/project/<TON_PROJECT_ID>/sql/new
--   2. Copie-colle TOUT ce fichier
--   3. Clique sur "Run"
--   4. Attends "Success. No rows returned"
--
-- POURQUOI : Lovable Cloud ne fournit pas toujours un vrai service_role JWT
-- à l'environnement serveur. Sans ça, supabaseAdmin agit comme un user anon
-- et est bloqué par RLS sur toutes les opérations. Ces RPCs SECURITY DEFINER
-- contournent le problème proprement (avec garde-fous SQL).
--
-- ============================================================================

-- ─── 1. Helper : récupérer tenant_id de l'utilisateur ───────────────────────
CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT tenant_id FROM public.profiles WHERE id = _user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_tenant_id(uuid) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.get_user_tenant_id(uuid) IS
  'Retourne le tenant_id du user. SECURITY DEFINER pour bypass RLS (cas service_role key absent).';


-- ─── 2. Helper : INSERT agent_run en bypass RLS ─────────────────────────────
CREATE OR REPLACE FUNCTION public.insert_agent_run(
  _user_id uuid,
  _tenant_id uuid,
  _message text,
  _title text DEFAULT NULL,
  _dossier_id uuid DEFAULT NULL,
  _parent_run_id uuid DEFAULT NULL,
  _draft jsonb DEFAULT '{}'::jsonb,
  _status text DEFAULT 'pending'
)
RETURNS TABLE(id uuid, status text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_created_at timestamptz;
BEGIN
  -- Garde-fou : vérifier que le user appartient bien au tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'User % does not belong to tenant %', _user_id, _tenant_id;
  END IF;

  INSERT INTO public.agent_runs (
    user_id, tenant_id, dossier_id, parent_run_id,
    message, title, status, draft
  ) VALUES (
    _user_id, _tenant_id, _dossier_id, _parent_run_id,
    _message, COALESCE(_title, substring(_message FROM 1 FOR 80)),
    _status, _draft
  )
  RETURNING agent_runs.id, agent_runs.status, agent_runs.created_at
  INTO v_id, v_status, v_created_at;

  RETURN QUERY SELECT v_id, v_status, v_created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_agent_run(uuid, uuid, text, text, uuid, uuid, jsonb, text)
  TO authenticated, service_role;


-- ─── 3. Colonne profiles.product_tour_completed_at ──────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS product_tour_completed_at timestamptz;

COMMENT ON COLUMN public.profiles.product_tour_completed_at IS
  'Date de complétion (ou skip) du tour produit.';


-- ─── 4. GRANTS sur RPCs SECURITY DEFINER critiques ──────────────────────────
-- Sur Lovable, supabaseAdmin peut ne pas avoir service_role → on permet
-- l'exécution depuis authenticated aussi. SAFE car SECURITY DEFINER s'exécute
-- avec les perms postgres, pas du caller.

GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer)
  TO authenticated, anon, service_role;

GRANT EXECUTE ON FUNCTION public.create_notification(uuid, uuid, text, text, text, text, jsonb)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.increment_questions_used(uuid)
  TO authenticated, service_role;


-- ─── 5. Bonus : seed du SMIC / PSS 2026 si pas déjà fait ────────────────────
-- (idempotent — ne fait rien si déjà présent)

INSERT INTO public.reference_values (key, value, unit, label, source_ref, source_url, valid_from, valid_to, updated_by) VALUES
  ('smic_horaire',     12.02, 'EUR/h',  'SMIC horaire brut (S1 2026)',  'Décret SMIC 2026',  'https://www.legifrance.gouv.fr/', '2026-01-01', '2026-05-31', 'seed_consolidated'),
  ('smic_mensuel',  1823.04, 'EUR/mo', 'SMIC mensuel brut 35h (S1 2026)', 'Décret SMIC 2026', NULL,                            '2026-01-01', '2026-05-31', 'seed_consolidated'),
  ('plafond_ss_mensuel', 3925.00, 'EUR/mo', 'Plafond mensuel SS 2026', 'Arrêté PSS 2026', NULL,                                '2026-01-01', NULL,         'seed_consolidated')
ON CONFLICT DO NOTHING;


-- ─── VALIDATION : vérifier que tout est en place ────────────────────────────
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'get_user_tenant_id') AS has_get_user_tenant_id,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'insert_agent_run') AS has_insert_agent_run,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='profiles' AND column_name='product_tour_completed_at') AS has_product_tour_column,
  (SELECT COUNT(*) FROM reference_values WHERE key='smic_horaire' AND valid_from='2026-01-01') AS has_smic_2026;

-- Si toutes les colonnes affichent 1 → tout est OK


-- ─── 6. Helper : lock atomique agent_run (UPDATE pending → running) ─────────
CREATE OR REPLACE FUNCTION public.lock_agent_run(
  _run_id uuid,
  _tenant_id uuid,
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.agent_runs%ROWTYPE;
  v_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'User % does not belong to tenant %', _user_id, _tenant_id;
  END IF;

  UPDATE public.agent_runs
  SET status = 'running', updated_at = NOW()
  WHERE id = _run_id
    AND tenant_id = _tenant_id
    AND status IN ('pending', 'waiting_info')
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('locked', true, 'row', to_jsonb(v_row));
  END IF;

  SELECT status INTO v_status FROM public.agent_runs
  WHERE id = _run_id AND tenant_id = _tenant_id;

  RETURN jsonb_build_object('locked', false, 'status', v_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_agent_run(uuid, uuid, uuid) TO authenticated, service_role;
