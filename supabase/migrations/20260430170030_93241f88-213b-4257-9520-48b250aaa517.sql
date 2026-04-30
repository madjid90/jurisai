-- Priorité 8 : Qualité production
-- 1) Métriques RAG avancées
ALTER TABLE public.rag_eval_runs
  ADD COLUMN IF NOT EXISTS retrieval_accuracy numeric,
  ADD COLUMN IF NOT EXISTS citation_coverage numeric,
  ADD COLUMN IF NOT EXISTS answer_correctness numeric,
  ADD COLUMN IF NOT EXISTS source_authority_score numeric,
  ADD COLUMN IF NOT EXISTS refusal_quality numeric,
  ADD COLUMN IF NOT EXISTS user_feedback_score numeric,
  ADD COLUMN IF NOT EXISTS notes text;

-- 2) Monitoring erreurs server functions
CREATE TABLE IF NOT EXISTS public.server_function_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  user_id uuid,
  tenant_id uuid,
  error_message text NOT NULL,
  error_stack text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('warn','error','critical')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sfe_function_created ON public.server_function_errors(function_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sfe_tenant_created ON public.server_function_errors(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sfe_severity_created ON public.server_function_errors(severity, created_at DESC);

ALTER TABLE public.server_function_errors ENABLE ROW LEVEL SECURITY;

-- Seuls les super_admins peuvent lire
CREATE POLICY "super_admin can read server_function_errors"
  ON public.server_function_errors
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Personne ne peut insérer/modifier/supprimer via PostgREST — seul service_role (bypass RLS)
-- (donc pas de policies INSERT/UPDATE/DELETE)

-- 3) Helper SECURITY DEFINER pour logger une erreur (callable depuis server functions sous service_role)
CREATE OR REPLACE FUNCTION public.log_server_error(
  _function_name text,
  _user_id uuid,
  _tenant_id uuid,
  _error_message text,
  _error_stack text,
  _context jsonb,
  _severity text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.server_function_errors (function_name, user_id, tenant_id, error_message, error_stack, context, severity)
  VALUES (_function_name, _user_id, _tenant_id, left(_error_message, 4000), left(coalesce(_error_stack,''), 8000), coalesce(_context,'{}'::jsonb), coalesce(_severity,'error'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.log_server_error(text,uuid,uuid,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_server_error(text,uuid,uuid,text,text,jsonb,text) TO service_role;

-- 4) Vue agrégée Data Quality (lecture super_admin via fonction)
CREATE OR REPLACE FUNCTION public.get_data_quality_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sources_total int;
  v_sources_active int;
  v_sources_stale int;
  v_chunks_total bigint;
  v_chunks_no_emb bigint;
  v_orphan_chunks bigint;
  v_ingestion_failed_24h int;
  v_avg_authority numeric;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*) INTO v_sources_total FROM public.legal_sources;
  SELECT COUNT(*) INTO v_sources_active FROM public.legal_sources WHERE is_active;
  SELECT COUNT(*) INTO v_sources_stale FROM public.legal_sources
    WHERE is_active AND (last_synced_at IS NULL OR last_synced_at < now() - interval '90 days');
  SELECT COUNT(*) INTO v_chunks_total FROM public.legal_chunks;
  SELECT COUNT(*) INTO v_chunks_no_emb FROM public.legal_chunks WHERE embedding IS NULL;
  SELECT COUNT(*) INTO v_orphan_chunks FROM public.legal_chunks c
    WHERE NOT EXISTS (SELECT 1 FROM public.legal_sources s WHERE s.id = c.source_id);
  SELECT COUNT(*) INTO v_ingestion_failed_24h FROM public.ingestion_jobs
    WHERE status = 'failed' AND created_at > now() - interval '24 hours';
  SELECT AVG(authority_level)::numeric INTO v_avg_authority FROM public.legal_sources WHERE is_active;

  RETURN jsonb_build_object(
    'sources_total', v_sources_total,
    'sources_active', v_sources_active,
    'sources_stale', v_sources_stale,
    'chunks_total', v_chunks_total,
    'chunks_without_embedding', v_chunks_no_emb,
    'orphan_chunks', v_orphan_chunks,
    'ingestion_failed_24h', v_ingestion_failed_24h,
    'avg_authority_level', v_avg_authority,
    'generated_at', now()
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.get_data_quality_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_data_quality_snapshot() TO authenticated;
