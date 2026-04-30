ALTER TABLE public.workflow_step_runs
  ADD COLUMN IF NOT EXISTS legal_sources jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.workflow_definitions
  ADD COLUMN IF NOT EXISTS requires_sourcing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workflow_step_runs.legal_sources IS
  'Sources juridiques (chunks RAG) utilisées pour générer le document de cette étape.';
COMMENT ON COLUMN public.workflow_definitions.requires_sourcing IS
  'Si true, chaque étape "generate_doc" doit avoir au moins une source légale avant génération.';