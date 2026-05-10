
CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN
  CREATE TYPE public.workflow_lifecycle_status AS ENUM (
    'draft_ai','ai_validated_auto','pending_human_review','human_validated','rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.workflow_definitions
  ADD COLUMN IF NOT EXISTS lifecycle_status public.workflow_lifecycle_status NOT NULL DEFAULT 'draft_ai',
  ADD COLUMN IF NOT EXISTS score_legal_refs    numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_logic         numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_documents     numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_completeness  numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_safety        numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_overall       numeric(5,2),
  ADD COLUMN IF NOT EXISTS generated_by_ai     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS generation_run_id   uuid,
  ADD COLUMN IF NOT EXISTS topic_embedding     vector(1536),
  ADD COLUMN IF NOT EXISTS requires_human_review     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contains_sensitive_actions boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sensitive_actions_detected jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS validated_by uuid,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS llm_model text,
  ADD COLUMN IF NOT EXISTS source_chunk_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.workflow_definitions
   SET lifecycle_status = CASE status::text
     WHEN 'validated'  THEN 'human_validated'::public.workflow_lifecycle_status
     WHEN 'review'     THEN 'pending_human_review'::public.workflow_lifecycle_status
     WHEN 'deprecated' THEN 'rejected'::public.workflow_lifecycle_status
     ELSE 'draft_ai'::public.workflow_lifecycle_status
   END
 WHERE lifecycle_status = 'draft_ai' AND status IS NOT NULL;

CREATE INDEX IF NOT EXISTS workflow_definitions_lifecycle_status_idx
  ON public.workflow_definitions (lifecycle_status);
CREATE INDEX IF NOT EXISTS workflow_definitions_category_lifecycle_idx
  ON public.workflow_definitions (category, lifecycle_status);
CREATE INDEX IF NOT EXISTS workflow_definitions_topic_embedding_hnsw
  ON public.workflow_definitions USING hnsw (topic_embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.workflow_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id   uuid NOT NULL,
  prompt    text NOT NULL,
  domain    text,
  category  text,
  llm_model text,
  status    text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed','rejected')),
  generated_definition_id uuid REFERENCES public.workflow_definitions(id) ON DELETE SET NULL,
  duplicate_of_definition_id uuid REFERENCES public.workflow_definitions(id) ON DELETE SET NULL,
  cache_hit boolean NOT NULL DEFAULT false,
  tokens_used integer,
  duration_ms integer,
  sources_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS workflow_generation_runs_tenant_idx
  ON public.workflow_generation_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_generation_runs_status_idx
  ON public.workflow_generation_runs (status);

ALTER TABLE public.workflow_generation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wgr_select_member ON public.workflow_generation_runs;
CREATE POLICY wgr_select_member ON public.workflow_generation_runs
  FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

DROP POLICY IF EXISTS wgr_insert_member ON public.workflow_generation_runs;
CREATE POLICY wgr_insert_member ON public.workflow_generation_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of_tenant(auth.uid(), tenant_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS wgr_update_admin ON public.workflow_generation_runs;
CREATE POLICY wgr_update_admin ON public.workflow_generation_runs
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id));

DO $$ BEGIN
  ALTER TABLE public.workflow_definitions
    ADD CONSTRAINT workflow_definitions_generation_run_fk
    FOREIGN KEY (generation_run_id) REFERENCES public.workflow_generation_runs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.workflow_quality_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_run_id uuid NOT NULL REFERENCES public.workflow_generation_runs(id) ON DELETE CASCADE,
  workflow_definition_id uuid REFERENCES public.workflow_definitions(id) ON DELETE CASCADE,
  check_type text NOT NULL
    CHECK (check_type IN ('legal_refs','logic','documents','completeness','safety','consensus','rerag')),
  passed boolean NOT NULL,
  score numeric(5,2),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wqc_run_idx ON public.workflow_quality_checks (generation_run_id);
CREATE INDEX IF NOT EXISTS wqc_def_idx ON public.workflow_quality_checks (workflow_definition_id);

ALTER TABLE public.workflow_quality_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wqc_select_member ON public.workflow_quality_checks;
CREATE POLICY wqc_select_member ON public.workflow_quality_checks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workflow_generation_runs r
      WHERE r.id = workflow_quality_checks.generation_run_id
        AND public.is_member_of_tenant(auth.uid(), r.tenant_id)
    )
  );

CREATE TABLE IF NOT EXISTS public.workflow_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id   uuid,
  workflow_definition_id uuid,
  workflow_instance_id   uuid,
  action text NOT NULL,
  actor_role text,
  before_state jsonb,
  after_state  jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz NOT NULL DEFAULT (now() + interval '10 years')
);
CREATE INDEX IF NOT EXISTS wal_tenant_idx ON public.workflow_audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wal_def_idx    ON public.workflow_audit_log (workflow_definition_id);
CREATE INDEX IF NOT EXISTS wal_inst_idx   ON public.workflow_audit_log (workflow_instance_id);
CREATE INDEX IF NOT EXISTS wal_action_idx ON public.workflow_audit_log (action);

ALTER TABLE public.workflow_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wal_select_admin ON public.workflow_audit_log;
CREATE POLICY wal_select_admin ON public.workflow_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id)
      OR public.is_super_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.sensitive_actions_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key text NOT NULL UNIQUE,
  action_label text NOT NULL,
  domain text NOT NULL
    CHECK (domain IN ('rh','commercial','societes','rgpd','fiscal','contentieux','administratif','contrats','reglementation','autre')),
  severity text NOT NULL DEFAULT 'high'
    CHECK (severity IN ('low','medium','high','critical')),
  requires_human_validation boolean NOT NULL DEFAULT true,
  requires_lawyer boolean NOT NULL DEFAULT false,
  legal_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  keywords text[] NOT NULL DEFAULT '{}',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sac_domain_idx ON public.sensitive_actions_catalog (domain);
CREATE INDEX IF NOT EXISTS sac_severity_idx ON public.sensitive_actions_catalog (severity);
CREATE INDEX IF NOT EXISTS sac_keywords_gin ON public.sensitive_actions_catalog USING GIN (keywords);

ALTER TABLE public.sensitive_actions_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sac_select_authenticated ON public.sensitive_actions_catalog;
CREATE POLICY sac_select_authenticated ON public.sensitive_actions_catalog
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS sac_super_admin_all ON public.sensitive_actions_catalog;
CREATE POLICY sac_super_admin_all ON public.sensitive_actions_catalog
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS sac_set_updated_at ON public.sensitive_actions_catalog;
CREATE TRIGGER sac_set_updated_at
  BEFORE UPDATE ON public.sensitive_actions_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
