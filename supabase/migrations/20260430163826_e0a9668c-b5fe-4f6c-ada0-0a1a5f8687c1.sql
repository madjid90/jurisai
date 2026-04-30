
-- Enrichissement document_templates avec config métier
ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS requires_upload boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upload_optional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_form boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_rag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_validation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archive_to_case boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_create_reminder boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_days_default integer,
  ADD COLUMN IF NOT EXISTS output_formats text[] NOT NULL DEFAULT ARRAY['pdf','docx']::text[],
  ADD COLUMN IF NOT EXISTS prefill_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS guidance text,
  ADD COLUMN IF NOT EXISTS validation_threshold text NOT NULL DEFAULT 'auto';

COMMENT ON COLUMN public.document_templates.prefill_sources IS
  'Tableau des sources de pré-remplissage : ["dossier","client","employee","contract","ocr","history","ai"]';
COMMENT ON COLUMN public.document_templates.validation_threshold IS
  'auto = selon risk_level ; always = toujours validation ; never = jamais';

-- Enrichissement document_generation_sessions
ALTER TABLE public.document_generation_sessions
  ADD COLUMN IF NOT EXISTS prefill_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS uncertain_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS legal_sources_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS detected_risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reminder_after_days integer;

-- Enrichissement generated_documents
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS legal_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reminder_id uuid;
