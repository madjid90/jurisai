-- Flag par tenant pour activer le pipeline Agent 360 RAG-first (Sprint J5).
-- Branché dans processAgentRun pour intent=lancer_procedure uniquement.
-- Par défaut ON pour tous les tenants existants et futurs.
-- Si false → fallback automatique sur l'ancien pipeline start_procedure_full.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS agent360_pipeline_enabled boolean DEFAULT true;

UPDATE public.tenants
SET agent360_pipeline_enabled = true
WHERE agent360_pipeline_enabled IS NULL;

COMMENT ON COLUMN public.tenants.agent360_pipeline_enabled IS
  'Active le pipeline Agent 360 RAG-first (LRE + Procedure + Workflow + Document Builders) pour les intents lancer_procedure. Si false, fallback sur l''ancien pipeline (start_procedure_full direct).';
