
ALTER TABLE public.document_analyses
  ADD COLUMN IF NOT EXISTS contract_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS detected_dates jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.dossier_deadlines
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_analysis_id uuid,
  ADD COLUMN IF NOT EXISTS deadline_type text;

CREATE INDEX IF NOT EXISTS idx_dossier_deadlines_source_analysis
  ON public.dossier_deadlines(source_analysis_id);
