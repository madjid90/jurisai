-- W8 : idempotence des relances d'étapes workflow.
ALTER TABLE public.workflow_step_runs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS workflow_step_runs_idem_uniq
  ON public.workflow_step_runs (instance_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;