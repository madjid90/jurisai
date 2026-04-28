-- =====================================================================
-- S1 : Index HNSW vectoriel + GIN full-text + filtres IDCC/source
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='legal_chunks' AND column_name='fts'
  ) THEN
    ALTER TABLE public.legal_chunks
      ADD COLUMN fts tsvector GENERATED ALWAYS AS (
        to_tsvector('french', coalesce(heading,'') || ' ' || coalesce(content,''))
      ) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS legal_chunks_embedding_hnsw_idx
  ON public.legal_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS legal_chunks_fts_idx
  ON public.legal_chunks USING gin (fts);

CREATE INDEX IF NOT EXISTS legal_chunks_source_id_idx
  ON public.legal_chunks (source_id);

CREATE INDEX IF NOT EXISTS legal_sources_idcc_idx
  ON public.legal_sources (idcc) WHERE idcc IS NOT NULL;

CREATE INDEX IF NOT EXISTS legal_sources_active_type_idx
  ON public.legal_sources (is_active, source_type);

-- =====================================================================
-- S5 : Profil utilisateur métier
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='user_profile_kind') THEN
    CREATE TYPE public.user_profile_kind AS ENUM (
      'dirigeant', 'rh', 'juriste', 'expert_comptable', 'manager_multi_sites'
    );
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_kind public.user_profile_kind,
  ADD COLUMN IF NOT EXISTS preferred_rag_mode text;

-- =====================================================================
-- S4 : Enrichissement document_templates EXISTANT
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='template_status') THEN
    CREATE TYPE public.template_status AS ENUM ('draft', 'review', 'validated', 'deprecated');
  END IF;
END $$;

ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS legal_basis jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS status public.template_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS validated_at timestamptz;

-- Backfill : modèles publics existants → status = validated
UPDATE public.document_templates
   SET status = 'validated'
 WHERE is_public = true AND status = 'draft';

-- Slug unique (par tenant + version)
CREATE UNIQUE INDEX IF NOT EXISTS document_templates_slug_unique
  ON public.document_templates (COALESCE(tenant_id::text,'public'), slug, version)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS document_templates_status_idx
  ON public.document_templates (status);

-- =====================================================================
-- S3 : Moteur de workflows métier RH/juridique
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  legal_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_duration_days int,
  status public.template_status NOT NULL DEFAULT 'draft',
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_def_slug_unique
  ON public.workflow_definitions (COALESCE(tenant_id::text,'public'), slug, version);

CREATE INDEX IF NOT EXISTS workflow_def_tenant_idx
  ON public.workflow_definitions (tenant_id);

CREATE TRIGGER workflow_def_updated_at
  BEFORE UPDATE ON public.workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.workflow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.workflow_definitions(id),
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  client_id uuid,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  current_step_index int NOT NULL DEFAULT 0,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_by uuid NOT NULL REFERENCES auth.users(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_instances_tenant_idx
  ON public.workflow_instances (tenant_id, status);
CREATE INDEX IF NOT EXISTS workflow_instances_dossier_idx
  ON public.workflow_instances (dossier_id);

CREATE TRIGGER workflow_instances_updated_at
  BEFORE UPDATE ON public.workflow_instances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.workflow_step_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.workflow_instances(id) ON DELETE CASCADE,
  step_index int NOT NULL,
  step_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  output jsonb,
  notes text,
  executed_by uuid REFERENCES auth.users(id),
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_step_runs_instance_idx
  ON public.workflow_step_runs (instance_id, step_index);

ALTER TABLE public.workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_step_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wfd_read" ON public.workflow_definitions
  FOR SELECT TO authenticated
  USING (
    (tenant_id IS NULL AND status = 'validated')
    OR tenant_id = public.current_tenant_id()
    OR public.is_super_admin(auth.uid())
  );
CREATE POLICY "wfd_super_admin_all" ON public.workflow_definitions
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "wfd_tenant_write" ON public.workflow_definitions
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin'::app_role, tenant_id)
  );
CREATE POLICY "wfd_tenant_update" ON public.workflow_definitions
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin'::app_role, tenant_id)
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "wfi_read_tenant" ON public.workflow_instances
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));
CREATE POLICY "wfi_insert_tenant" ON public.workflow_instances
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND started_by = auth.uid());
CREATE POLICY "wfi_update_tenant" ON public.workflow_instances
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "wfi_delete_tenant" ON public.workflow_instances
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin'::app_role, tenant_id)
  );

CREATE POLICY "wsr_read" ON public.workflow_step_runs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workflow_instances wi
    WHERE wi.id = workflow_step_runs.instance_id
      AND (wi.tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()))
  ));
CREATE POLICY "wsr_write" ON public.workflow_step_runs
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workflow_instances wi
    WHERE wi.id = workflow_step_runs.instance_id
      AND wi.tenant_id = public.current_tenant_id()
  ));
CREATE POLICY "wsr_update" ON public.workflow_step_runs
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workflow_instances wi
    WHERE wi.id = workflow_step_runs.instance_id
      AND wi.tenant_id = public.current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workflow_instances wi
    WHERE wi.id = workflow_step_runs.instance_id
      AND wi.tenant_id = public.current_tenant_id()
  ));

-- =====================================================================
-- S2 : Cache embeddings
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.embedding_cache (
  query_hash text PRIMARY KEY,
  embedding vector(1536) NOT NULL,
  hit_count int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_hit_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS embedding_cache_last_hit_idx
  ON public.embedding_cache (last_hit_at);

ALTER TABLE public.embedding_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "embcache_super_admin_read" ON public.embedding_cache
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- =====================================================================
-- Seed : 2 workflows pilotes validés
-- =====================================================================

INSERT INTO public.workflow_definitions
  (tenant_id, slug, title, description, category, steps, legal_refs, estimated_duration_days, status)
SELECT NULL, 'absence-injustifiee', 'Absence injustifiée d''un salarié',
  'Procédure complète : demande de justification, relance, mise en demeure, qualification de la faute.',
  'discipline',
  '[
    {"key":"collecte_infos","title":"Collecter les informations","kind":"manual","fields":["nom_salarie","date_debut_absence","poste","contrat_type"]},
    {"key":"demande_justification","title":"Envoyer demande de justification","kind":"generate_doc","template_slug":"demande-justification-absence","delay_days":0},
    {"key":"attente_reponse","title":"Attendre réponse du salarié","kind":"wait","delay_days":3},
    {"key":"mise_en_demeure","title":"Envoyer mise en demeure","kind":"generate_doc","template_slug":"mise-en-demeure-reprise","delay_days":3,"condition":"no_response"},
    {"key":"qualification_faute","title":"Qualifier la faute (assistance IA)","kind":"manual","ai_assist":true},
    {"key":"convocation_entretien","title":"Convoquer à un entretien préalable","kind":"generate_doc","template_slug":"convocation-entretien-prealable","delay_days":5,"optional":true},
    {"key":"archive_dossier","title":"Archiver dans le dossier salarié","kind":"manual"}
  ]'::jsonb,
  '["Art. L1232-1 Code du travail","Art. L1331-1 Code du travail","Cass. soc. 13 mai 2014, n° 13-13.846"]'::jsonb,
  15, 'validated'
WHERE NOT EXISTS (
  SELECT 1 FROM public.workflow_definitions WHERE slug='absence-injustifiee' AND tenant_id IS NULL
);

INSERT INTO public.workflow_definitions
  (tenant_id, slug, title, description, category, steps, legal_refs, estimated_duration_days, status)
SELECT NULL, 'convocation-entretien-prealable', 'Convocation à entretien préalable',
  'Procédure encadrée : convocation, délai légal, tenue de l''entretien, notification décision.',
  'discipline',
  '[
    {"key":"collecte_infos","title":"Renseigner le contexte","kind":"manual","fields":["nom_salarie","faits_reproches","sanction_envisagee","lieu_entretien","date_entretien"]},
    {"key":"verif_delai","title":"Vérifier le délai légal (5 jours ouvrables minimum)","kind":"manual","ai_assist":true},
    {"key":"generer_convocation","title":"Générer la lettre de convocation","kind":"generate_doc","template_slug":"convocation-entretien-prealable","delay_days":0},
    {"key":"envoi_lrar","title":"Envoyer en LRAR ou remise en main propre","kind":"manual","delay_days":0},
    {"key":"tenir_entretien","title":"Tenir l''entretien (compte-rendu)","kind":"manual","delay_days":7},
    {"key":"reflexion","title":"Délai de réflexion (2 jours ouvrables minimum)","kind":"wait","delay_days":2},
    {"key":"notifier_decision","title":"Notifier la décision","kind":"generate_doc","template_slug":"notification-sanction","delay_days":2},
    {"key":"archive_dossier","title":"Archiver dans le dossier salarié","kind":"manual"}
  ]'::jsonb,
  '["Art. L1232-2 Code du travail","Art. L1232-3 Code du travail","Art. L1232-4 Code du travail","Art. L1332-2 Code du travail"]'::jsonb,
  12, 'validated'
WHERE NOT EXISTS (
  SELECT 1 FROM public.workflow_definitions WHERE slug='convocation-entretien-prealable' AND tenant_id IS NULL
);