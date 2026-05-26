-- ════════════════════════════════════════════════════════════════════════════
-- Sprint J1 — Fondations Agent 360 RAG-first (2026-05-24)
-- ════════════════════════════════════════════════════════════════════════════
-- Crée 4 tables qui structurent l'utilisation de la data juridique existante
-- (190 k chunks RAG) sans dupliquer ni inventer de contenu juridique.
--
-- Tables 1 & 2 : seed minimal méta (rangs autorité + 10 règles opérationnelles)
-- Tables 3 & 4 : VIDES — alimentées dynamiquement par le LLM depuis le RAG
--
-- Cf docs/ARCHITECTURE-AGENT-360-RAG-FIRST.md
-- Appliqué en prod via Supabase MCP le 2026-05-24.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. legal_source_hierarchy ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.legal_source_hierarchy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL UNIQUE,
  label text NOT NULL,
  authority_rank int NOT NULL,
  default_boost numeric DEFAULT 1.0,
  procedure_boost numeric DEFAULT 1.0,
  contentieux_boost numeric DEFAULT 1.0,
  document_boost numeric DEFAULT 1.0,
  is_binding boolean DEFAULT false,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.legal_source_hierarchy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lsh_read_all ON public.legal_source_hierarchy;
CREATE POLICY lsh_read_all ON public.legal_source_hierarchy FOR SELECT USING (true);

INSERT INTO public.legal_source_hierarchy
  (source_type, label, authority_rank, procedure_boost, document_boost, is_binding, description)
VALUES
  ('code_article',           'Article de code',                   10, 1.5, 1.5, true,  'Source primaire : Code travail, civil, commerce, consommation, etc.'),
  ('doctrine_fiscale',       'Doctrine fiscale (BOFIP)',          15, 1.3, 1.3, true,  'Opposable à l''administration fiscale (CGI art. L80A LPF)'),
  ('convention_article',     'Article de convention collective',  20, 1.4, 1.3, true,  'Applicable selon IDCC du tenant — principe de faveur en droit social'),
  ('accord_entreprise',      'Accord d''entreprise',              30, 1.2, 1.1, true,  'Prioritaire si lié à l''entreprise du tenant'),
  ('fiche_ministere_travail', 'Fiche officielle Ministère',        40, 1.0, 1.0, false, 'Source officielle interprétative (CDTN)'),
  ('fiche_service_public',   'Fiche Service-Public.fr',           45, 0.9, 0.9, false, 'Vulgarisation officielle'),
  ('jurisprudence',          'Jurisprudence',                     60, 0.8, 0.7, false, 'Interprète mais ne remplace pas le texte applicable'),
  ('modele_courrier',        'Modèle de courrier',                80, 0.5, 1.5, false, 'Sert à la génération doc, jamais à fonder une règle')
ON CONFLICT (source_type) DO UPDATE SET
  label = EXCLUDED.label,
  authority_rank = EXCLUDED.authority_rank,
  procedure_boost = EXCLUDED.procedure_boost,
  document_boost = EXCLUDED.document_boost,
  is_binding = EXCLUDED.is_binding,
  description = EXCLUDED.description;

COMMENT ON TABLE public.legal_source_hierarchy IS
  'Rang d''autorité par source_type existant dans legal_sources. Utilisé par le LRE pour trier les sources.';

-- ─── 2. legal_doctrine_rules ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.legal_doctrine_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  intent text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN (
    'hierarchy','source_priority','conflict_resolution','answer_structure',
    'procedure_method','risk_rule','refusal_rule','validation_rule'
  )),
  title text NOT NULL,
  content text NOT NULL,
  priority int DEFAULT 100,
  examples jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ldr_domain_intent ON public.legal_doctrine_rules(domain, intent, is_active);
CREATE INDEX IF NOT EXISTS idx_ldr_type ON public.legal_doctrine_rules(rule_type, is_active);

ALTER TABLE public.legal_doctrine_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ldr_read_all ON public.legal_doctrine_rules;
CREATE POLICY ldr_read_all ON public.legal_doctrine_rules FOR SELECT USING (true);

INSERT INTO public.legal_doctrine_rules (domain, intent, rule_type, title, content, priority) VALUES
  ('all', 'all', 'hierarchy', 'Sources normatives avant interprétatives',
   'Le LLM doit privilégier les textes législatifs et réglementaires (code_article, convention_article) avant la jurisprudence. La jurisprudence sert à interpréter, pas à remplacer le texte applicable lorsqu''il existe.', 10),
  ('droit_social', 'all', 'source_priority', 'Ordre des sources en droit social',
   'Pour toute question/procédure en droit social, ordre de priorité strict : 1) Code du travail, 2) Convention collective applicable (selon IDCC du tenant), 3) Accord d''entreprise si disponible, 4) Fiches officielles Ministère/Service-Public, 5) Jurisprudence en complément uniquement.', 20),
  ('droit_fiscal', 'all', 'source_priority', 'Ordre des sources en fiscal',
   'Pour toute question fiscale : 1) Code général des impôts, 2) Doctrine BOFIP (opposable à l''administration), 3) Jurisprudence Conseil d''État, 4) Fiches Service-Public.', 20),
  ('all', 'all', 'refusal_rule', 'Refus si pas de source RAG',
   'Si AUCUNE source juridique n''est trouvée dans le RAG pour appuyer une affirmation, le LLM DOIT refuser ou marquer explicitement "à vérifier — pas de source disponible". Aucune affirmation juridique sans source.', 5),
  ('all', 'all', 'procedure_method', 'Chaque étape doit pointer une source réelle',
   'Toute étape d''une procédure construite par le LLM DOIT contenir un source_id pointant vers une ligne réelle de legal_sources, ainsi qu''un verbatim correspondant à un chunk réel de legal_chunks. Le Verifier rejette toute étape sans source vérifiable.', 10),
  ('all', 'all', 'procedure_method', 'Délais légaux sourcés obligatoirement',
   'Chaque délai légal mentionné (ex: 5 jours entre convocation et entretien) DOIT citer l''article qui le fixe (ex: L1232-2). Si le délai dépend d''une convention collective dont l''IDCC est inconnu, marquer "à vérifier convention collective".', 10),
  ('droit_social', 'all', 'conflict_resolution', 'Principe de faveur',
   'En droit social, en cas de conflit entre norme générale (Code, convention) et contrat individuel, ou entre convention de branche et accord d''entreprise, la disposition la plus favorable au salarié s''applique (sauf disposition d''ordre public absolu).', 30),
  ('all', 'all', 'validation_rule', 'Actions sensibles obligatoirement validées',
   'Les actions suivantes DOIVENT être bloquées jusqu''à validation humaine : licenciement, sanction disciplinaire, rupture conventionnelle, mise en demeure envoyée, transaction, engagement contentieux, réponse officielle, engagement contractuel, action RH défavorable. Liste codée en dur dans blockSensitiveActionUntilValidation, jamais confiée au jugement du LLM.', 5),
  ('all', 'all', 'answer_structure', 'Output JSON Zod strict',
   'Tous les outputs structurés (procédures, documents, qualifications) doivent être au format JSON conforme aux schemas Zod fournis dans le contexte. Pas de texte libre pour ces sorties — uniquement du JSON validable.', 15),
  ('rgpd', 'all', 'risk_rule', 'Données sensibles RGPD',
   'Toute manipulation de données mentionnées aux articles 9 (santé, biométrie, opinion, etc.) ou 10 (condamnations) du RGPD nécessite une mention explicite du risque + vérification DPO + base légale spécifique citée depuis le RGPD.', 40)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.legal_doctrine_rules IS
  'Règles méta-opérationnelles qui guident le LLM dans son raisonnement. AUCUN contenu juridique : juste méthodologie.';

-- ─── 3. procedure_generation_rules (CACHE LLM) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.procedure_generation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  procedure_slug text NOT NULL,
  domain text NOT NULL,
  title text NOT NULL,
  qualification jsonb NOT NULL,
  source_ids uuid[] NOT NULL,
  steps jsonb NOT NULL,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  deadlines jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_level text DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  built_by_llm boolean DEFAULT true,
  built_by_model text,
  source_corpus_hash text,
  verified boolean DEFAULT false,
  verified_at timestamptz,
  reuse_count int DEFAULT 0,
  last_reused_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, procedure_slug)
);

CREATE INDEX IF NOT EXISTS idx_pgr_slug_active ON public.procedure_generation_rules(procedure_slug, is_active);
CREATE INDEX IF NOT EXISTS idx_pgr_domain ON public.procedure_generation_rules(domain, is_active);
CREATE INDEX IF NOT EXISTS idx_pgr_tenant ON public.procedure_generation_rules(tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE public.procedure_generation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pgr_read_global_or_tenant ON public.procedure_generation_rules;
CREATE POLICY pgr_read_global_or_tenant ON public.procedure_generation_rules FOR SELECT
  USING (tenant_id IS NULL OR tenant_id IN (SELECT user_roles.tenant_id FROM user_roles WHERE user_roles.user_id = auth.uid()));

DROP POLICY IF EXISTS pgr_insert_tenant ON public.procedure_generation_rules;
CREATE POLICY pgr_insert_tenant ON public.procedure_generation_rules FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id IN (SELECT user_roles.tenant_id FROM user_roles WHERE user_roles.user_id = auth.uid()));

COMMENT ON TABLE public.procedure_generation_rules IS
  'CACHE des procédures construites par le LLM depuis le RAG. VIDE au seed — alimentée par buildLegalProcedure().';

-- ─── 4. document_generation_rules (CACHE LLM) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_generation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  domain text NOT NULL,
  template_slug text,
  required_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_legal_mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  forbidden_phrases jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_ids uuid[] NOT NULL DEFAULT '{}',
  validation_required boolean DEFAULT true,
  output_formats text[] DEFAULT ARRAY['pdf','docx'],
  built_by_llm boolean DEFAULT true,
  built_by_model text,
  source_corpus_hash text,
  verified boolean DEFAULT false,
  verified_at timestamptz,
  reuse_count int DEFAULT 0,
  last_reused_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_dgr_type ON public.document_generation_rules(document_type, is_active);
CREATE INDEX IF NOT EXISTS idx_dgr_domain ON public.document_generation_rules(domain, is_active);
CREATE INDEX IF NOT EXISTS idx_dgr_tenant ON public.document_generation_rules(tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE public.document_generation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dgr_read_global_or_tenant ON public.document_generation_rules;
CREATE POLICY dgr_read_global_or_tenant ON public.document_generation_rules FOR SELECT
  USING (tenant_id IS NULL OR tenant_id IN (SELECT user_roles.tenant_id FROM user_roles WHERE user_roles.user_id = auth.uid()));

DROP POLICY IF EXISTS dgr_insert_tenant ON public.document_generation_rules;
CREATE POLICY dgr_insert_tenant ON public.document_generation_rules FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id IN (SELECT user_roles.tenant_id FROM user_roles WHERE user_roles.user_id = auth.uid()));

COMMENT ON TABLE public.document_generation_rules IS
  'CACHE des grilles de validation documents construites par le LLM depuis le RAG. VIDE au seed.';
