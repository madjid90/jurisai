-- RPC SECURITY DEFINER : crée un dossier pour un run sans workflow obligatoire.
-- Utilisée pour les intents qui méritent un dossier mais pas de workflow strict
-- (chiffrage, analyse_document, reclamation, conformite, etc.)
--
-- Synced from prod le 2026-05-24 (cf AUDIT-JURISAI-V6.md §3 P2 drift git/Supabase).

CREATE OR REPLACE FUNCTION public.create_dossier_for_run(
  _user_id uuid,
  _tenant_id uuid,
  _run_id uuid,
  _title text,
  _category text DEFAULT 'general',
  _description text DEFAULT NULL,
  _risk_level text DEFAULT 'medium'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dossier_id uuid;
BEGIN
  -- Garde-fou tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'User % does not belong to tenant %', _user_id, _tenant_id;
  END IF;

  -- Idempotent : si le run a déjà un dossier, on le renvoie
  SELECT dossier_id INTO v_dossier_id FROM public.agent_runs
  WHERE id = _run_id AND tenant_id = _tenant_id;

  IF v_dossier_id IS NOT NULL THEN
    RETURN jsonb_build_object('dossier_id', v_dossier_id, 'created', false);
  END IF;

  INSERT INTO public.dossiers (
    tenant_id, created_by, title, description, category, status, risk_level
  ) VALUES (
    _tenant_id,
    _user_id,
    _title,
    COALESCE(_description, 'Dossier créé automatiquement depuis une demande agent.'),
    _category,
    'open',
    _risk_level
  )
  RETURNING id INTO v_dossier_id;

  UPDATE public.agent_runs
  SET dossier_id = v_dossier_id, updated_at = now()
  WHERE id = _run_id AND tenant_id = _tenant_id;

  RETURN jsonb_build_object('dossier_id', v_dossier_id, 'created', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_dossier_for_run(uuid, uuid, uuid, text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.create_dossier_for_run IS
  'Crée un dossier rattaché à un agent_run (idempotent). Pour intents sans workflow associé.';
