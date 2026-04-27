-- Étendre legal_sources pour idempotence des connecteurs API
ALTER TABLE public.legal_sources
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS connector TEXT,
  ADD COLUMN IF NOT EXISTS raw_metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS legal_date DATE,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Index unique pour upsert idempotent (un même article Légifrance ne doit pas être dupliqué)
CREATE UNIQUE INDEX IF NOT EXISTS legal_sources_connector_external_id_idx
  ON public.legal_sources(connector, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS legal_sources_connector_idx ON public.legal_sources(connector);
CREATE INDEX IF NOT EXISTS legal_sources_legal_date_idx ON public.legal_sources(legal_date);

-- Étendre ingestion_jobs avec champs de progression détaillée
ALTER TABLE public.ingestion_jobs
  ADD COLUMN IF NOT EXISTS connector TEXT,
  ADD COLUMN IF NOT EXISTS items_total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_processed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_failed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS params JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS ingestion_jobs_connector_status_idx
  ON public.ingestion_jobs(connector, status, created_at DESC);

-- Table de suivi détaillé des erreurs d'ingestion (pour debug + retry)
CREATE TABLE IF NOT EXISTS public.ingestion_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES public.ingestion_jobs(id) ON DELETE CASCADE,
  connector TEXT NOT NULL,
  external_id TEXT,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  retry_count INTEGER DEFAULT 0,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_errors_job_idx ON public.ingestion_errors(job_id);
CREATE INDEX IF NOT EXISTS ingestion_errors_unresolved_idx
  ON public.ingestion_errors(connector, resolved) WHERE resolved = FALSE;

ALTER TABLE public.ingestion_errors ENABLE ROW LEVEL SECURITY;

-- Seuls super_admins voient les erreurs (debug interne)
CREATE POLICY "super_admins manage ingestion_errors"
  ON public.ingestion_errors FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- Table conventions collectives (KALI structuré, séparé de legal_sources pour requêtes IDCC rapides)
CREATE TABLE IF NOT EXISTS public.conventions_collectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idcc TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  short_title TEXT,
  brochure TEXT,
  is_extended BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  effectif INTEGER,
  naf_codes TEXT[] DEFAULT '{}',
  source_url TEXT,
  raw_metadata JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conventions_collectives_idcc_idx ON public.conventions_collectives(idcc);
CREATE INDEX IF NOT EXISTS conventions_collectives_naf_idx ON public.conventions_collectives USING GIN(naf_codes);

ALTER TABLE public.conventions_collectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read conventions"
  ON public.conventions_collectives FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "super_admins manage conventions"
  ON public.conventions_collectives FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER trg_conventions_collectives_updated_at
  BEFORE UPDATE ON public.conventions_collectives
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table modèles publics (templates SocialGouv)
CREATE TABLE IF NOT EXISTS public.templates_public (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  content_md TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb,
  legal_basis TEXT[] DEFAULT '{}',
  disclaimer TEXT,
  quality_level TEXT DEFAULT 'public_unverified',
  source_url TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS templates_public_category_idx ON public.templates_public(category);

ALTER TABLE public.templates_public ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read templates"
  ON public.templates_public FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "super_admins manage templates"
  ON public.templates_public FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER trg_templates_public_updated_at
  BEFORE UPDATE ON public.templates_public
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();