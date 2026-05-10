-- 1) Lien agent_runs ↔ workflow_instances
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS workflow_instance_id uuid
    REFERENCES public.workflow_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_workflow_instance
  ON public.agent_runs(workflow_instance_id)
  WHERE workflow_instance_id IS NOT NULL;

-- 2) Cycle de vie workflow_instances
ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

CREATE INDEX IF NOT EXISTS idx_workflow_instances_tenant_status
  ON public.workflow_instances(tenant_id, status);

-- 3) Vue santé runtime (par tenant)
CREATE OR REPLACE VIEW public.v_workflow_runtime_health
WITH (security_invoker = on) AS
SELECT
  wi.tenant_id,
  COUNT(*) FILTER (WHERE wi.status IN ('pending','in_progress'))            AS active_count,
  COUNT(*) FILTER (WHERE wi.status = 'completed' AND wi.completed_at >= now() - interval '30 days') AS completed_30d,
  COUNT(*) FILTER (WHERE wi.status = 'cancelled')                            AS cancelled_count,
  COUNT(DISTINCT wsr.instance_id) FILTER (WHERE wsr.requires_validation = true AND wsr.status = 'pending') AS blocked_for_validation,
  COUNT(DISTINCT wsr.instance_id) FILTER (WHERE wsr.due_at < now() AND wsr.status IN ('pending','in_progress')) AS overdue_instances
FROM public.workflow_instances wi
LEFT JOIN public.workflow_step_runs wsr ON wsr.instance_id = wi.id
GROUP BY wi.tenant_id;

-- 4) Vue étapes en retard (drill-down)
CREATE OR REPLACE VIEW public.v_workflow_overdue_steps
WITH (security_invoker = on) AS
SELECT
  wsr.id              AS step_run_id,
  wsr.instance_id,
  wi.tenant_id,
  wi.dossier_id,
  wi.title            AS instance_title,
  wsr.step_index,
  wsr.step_key,
  wsr.due_at,
  wsr.status,
  EXTRACT(EPOCH FROM (now() - wsr.due_at)) / 86400.0 AS days_overdue,
  wsr.requires_validation
FROM public.workflow_step_runs wsr
JOIN public.workflow_instances wi ON wi.id = wsr.instance_id
WHERE wsr.due_at IS NOT NULL
  AND wsr.due_at < now()
  AND wsr.status IN ('pending','in_progress');