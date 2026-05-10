-- W6/W9 — Empêche au niveau base les double-insertions de step_runs pour
-- une même étape « active ». On autorise plusieurs lignes superseded pour
-- l'historique d'avancements concurrents.
CREATE UNIQUE INDEX IF NOT EXISTS workflow_step_runs_active_step_uniq
ON public.workflow_step_runs (instance_id, step_index)
WHERE status IN ('done', 'pending', 'in_progress');