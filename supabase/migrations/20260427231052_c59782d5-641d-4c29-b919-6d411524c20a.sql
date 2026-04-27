-- ============ S1: AI Feedback ============
CREATE TABLE IF NOT EXISTS public.message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating IN (-1, 1)),
  reason text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own feedback" ON public.message_feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Users view own feedback" ON public.message_feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins view tenant feedback" ON public.message_feedback
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE POLICY "Users update own feedback" ON public.message_feedback
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_message_feedback_message ON public.message_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_message_feedback_tenant ON public.message_feedback(tenant_id, created_at DESC);

-- ============ S2: Authority level + versioning ============
ALTER TABLE public.legal_sources
  ADD COLUMN IF NOT EXISTS authority_level smallint NOT NULL DEFAULT 3
    CHECK (authority_level BETWEEN 1 AND 6),
  ADD COLUMN IF NOT EXISTS quality_score real DEFAULT 0.5 CHECK (quality_score BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS last_quality_check_at timestamptz;

COMMENT ON COLUMN public.legal_sources.authority_level IS
  '1=Code/Loi, 2=Décret, 3=CC, 4=Juris CCass, 5=Juris CA/CPH, 6=Doctrine/blog';

CREATE TABLE IF NOT EXISTS public.legal_article_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  reference_code text NOT NULL,
  version_date date NOT NULL,
  content text NOT NULL,
  diff_summary text,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, version_date)
);
ALTER TABLE public.legal_article_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read versions" ON public.legal_article_versions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admin manage versions" ON public.legal_article_versions
  FOR ALL TO authenticated
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_article_versions_ref ON public.legal_article_versions(reference_code, version_date DESC);

-- Quality checks log (S2 dashboard)
CREATE TABLE IF NOT EXISTS public.data_quality_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
  metric_value numeric,
  threshold numeric,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ran_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.data_quality_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin read quality" ON public.data_quality_checks
  FOR SELECT TO authenticated USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin write quality" ON public.data_quality_checks
  FOR INSERT TO authenticated WITH CHECK (is_super_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_quality_checks_recent ON public.data_quality_checks(ran_at DESC, check_name);

-- ============ S5: RAG evaluation ============
CREATE TABLE IF NOT EXISTS public.rag_eval_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  expected_sources text[] NOT NULL DEFAULT '{}',
  expected_answer_keywords text[] NOT NULL DEFAULT '{}',
  category text NOT NULL DEFAULT 'general',
  difficulty text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  idcc text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rag_eval_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin manage eval cases" ON public.rag_eval_cases
  FOR ALL TO authenticated
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.rag_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  precision_at_5 real,
  mrr real,
  retrieved_sources text[] DEFAULT '{}',
  answer text,
  hallucination_detected boolean DEFAULT false,
  latency_ms integer,
  model text,
  ran_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rag_eval_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin read eval runs" ON public.rag_eval_runs
  FOR SELECT TO authenticated USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin write eval runs" ON public.rag_eval_runs
  FOR INSERT TO authenticated WITH CHECK (is_super_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_eval_runs_recent ON public.rag_eval_runs(ran_at DESC);

-- ============ S6: Observability + Billing ============
CREATE TABLE IF NOT EXISTS public.system_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name text NOT NULL,
  metric_value numeric NOT NULL,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin read metrics" ON public.system_metrics
  FOR SELECT TO authenticated USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin insert metrics" ON public.system_metrics
  FOR INSERT TO authenticated WITH CHECK (is_super_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_metrics_recent ON public.system_metrics(metric_name, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_type text NOT NULL,
  amount_cents integer,
  currency text DEFAULT 'EUR',
  stripe_event_id text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view tenant billing" ON public.billing_events
  FOR SELECT TO authenticated
  USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE INDEX IF NOT EXISTS idx_billing_tenant ON public.billing_events(tenant_id, created_at DESC);

-- ============ S2 helper: data quality check function ============
CREATE OR REPLACE FUNCTION public.run_data_quality_checks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_sources integer;
  v_stale_sources integer;
  v_orphan_chunks integer;
  v_no_embedding integer;
BEGIN
  SELECT COUNT(*) INTO v_total_sources FROM public.legal_sources WHERE is_active;
  INSERT INTO public.data_quality_checks(check_name, status, metric_value, threshold, details)
  VALUES ('active_sources_count',
    CASE WHEN v_total_sources >= 50 THEN 'pass' WHEN v_total_sources >= 10 THEN 'warn' ELSE 'fail' END,
    v_total_sources, 50, jsonb_build_object('description', 'Nombre de sources légales actives'));

  SELECT COUNT(*) INTO v_stale_sources FROM public.legal_sources
   WHERE is_active AND (last_synced_at IS NULL OR last_synced_at < now() - interval '90 days');
  INSERT INTO public.data_quality_checks(check_name, status, metric_value, threshold, details)
  VALUES ('stale_sources',
    CASE WHEN v_stale_sources = 0 THEN 'pass' WHEN v_stale_sources < 5 THEN 'warn' ELSE 'fail' END,
    v_stale_sources, 0, jsonb_build_object('description', 'Sources non resynchronisées depuis 90j'));

  SELECT COUNT(*) INTO v_orphan_chunks FROM public.legal_chunks c
   WHERE NOT EXISTS (SELECT 1 FROM public.legal_sources s WHERE s.id = c.source_id);
  INSERT INTO public.data_quality_checks(check_name, status, metric_value, threshold, details)
  VALUES ('orphan_chunks',
    CASE WHEN v_orphan_chunks = 0 THEN 'pass' ELSE 'fail' END,
    v_orphan_chunks, 0, jsonb_build_object('description', 'Chunks sans source parente'));

  SELECT COUNT(*) INTO v_no_embedding FROM public.legal_chunks WHERE embedding IS NULL;
  INSERT INTO public.data_quality_checks(check_name, status, metric_value, threshold, details)
  VALUES ('chunks_without_embedding',
    CASE WHEN v_no_embedding = 0 THEN 'pass' WHEN v_no_embedding < 100 THEN 'warn' ELSE 'fail' END,
    v_no_embedding, 0, jsonb_build_object('description', 'Chunks non vectorisés'));
END $$;