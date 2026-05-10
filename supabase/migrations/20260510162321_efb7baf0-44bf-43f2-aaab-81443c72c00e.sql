
ALTER TABLE public.workflow_step_runs
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS delay_calculation jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS requires_validation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS validation_request_id uuid REFERENCES public.validation_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS step_definition jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_instance_step
  ON public.workflow_step_runs(instance_id, step_index);

CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_due_at
  ON public.workflow_step_runs(due_at)
  WHERE due_at IS NOT NULL AND status IN ('pending','in_progress');
