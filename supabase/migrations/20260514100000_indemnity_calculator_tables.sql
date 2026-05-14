-- ============================================================================
-- CALCULATEUR D'INDEMNITÉS — Tables versionnées avec mise à jour automatique
-- ============================================================================
-- Principe : chaque valeur a un valid_from/valid_to pour gérer l'historique.
-- On ne supprime JAMAIS une ancienne valeur, on la clôture (valid_to = veille du nouveau).
-- Le moteur de calcul utilise toujours la valeur active à la date du fait générateur.
-- ============================================================================

-- ─── 1. Valeurs de référence nationales (SMIC, PSS, taux...) ───────────────

CREATE TABLE IF NOT EXISTS reference_values (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL,                      -- ex: smic_horaire, smic_mensuel, plafond_ss_mensuel, plafond_ss_annuel
  value       numeric NOT NULL,
  unit        text NOT NULL DEFAULT 'EUR',         -- EUR, PERCENT, DAYS, MONTHS
  label       text NOT NULL,                       -- libellé humain
  source_ref  text,                                -- ex: "Décret n°2024-951 du 23/10/2024"
  source_url  text,                                -- lien Legifrance
  valid_from  date NOT NULL,
  valid_to    date,                                -- NULL = valeur en vigueur
  updated_by  text DEFAULT 'seed',                 -- seed | admin | cron | agent
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),

  CONSTRAINT uq_ref_value_period UNIQUE (key, valid_from)
);

CREATE INDEX idx_ref_values_key_date ON reference_values (key, valid_from DESC);
CREATE INDEX idx_ref_values_active ON reference_values (key) WHERE valid_to IS NULL;

COMMENT ON TABLE reference_values IS 'Valeurs de référence nationales versionnées (SMIC, PSS, taux). Chaque modification crée une nouvelle ligne avec valid_from.';

-- ─── 2. Barème Macron (indemnités prud''homales) ────────────────────────────

CREATE TABLE IF NOT EXISTS macron_scale (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seniority_years integer NOT NULL,               -- ancienneté en années complètes
  min_months      numeric NOT NULL,               -- plancher en mois de salaire brut
  max_months      numeric NOT NULL,               -- plafond en mois de salaire brut
  company_size    text NOT NULL DEFAULT 'standard', -- standard (≥11 sal.) | small (<11 sal.)
  valid_from      date NOT NULL,
  valid_to        date,
  source_ref      text DEFAULT 'Art. L1235-3 Code du travail',
  created_at      timestamptz DEFAULT now(),

  CONSTRAINT uq_macron_period UNIQUE (seniority_years, company_size, valid_from)
);

CREATE INDEX idx_macron_active ON macron_scale (company_size, seniority_years) WHERE valid_to IS NULL;

COMMENT ON TABLE macron_scale IS 'Barème Macron : planchers/plafonds indemnités prud''homales selon ancienneté et taille entreprise. Art. L1235-3 CT.';

-- ─── 3. Formules d''indemnités légales ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS indemnity_formulas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,                   -- licenciement_legal, preavis, conges_payes, rupture_conv, mise_retraite, depart_retraite
  label           text NOT NULL,
  formula_json    jsonb NOT NULL,                  -- formule structurée (voir commentaire)
  conditions_json jsonb DEFAULT '{}',              -- conditions d'application
  source_ref      text NOT NULL,                   -- article de loi
  source_url      text,
  valid_from      date NOT NULL,
  valid_to        date,
  created_at      timestamptz DEFAULT now(),

  CONSTRAINT uq_formula_period UNIQUE (type, valid_from)
);

COMMENT ON TABLE indemnity_formulas IS 'Formules légales d''indemnités. formula_json contient les règles de calcul structurées.';
-- Exemple formula_json pour indemnité légale de licenciement :
-- {
--   "rules": [
--     { "up_to_years": 10, "rate": 0.25, "basis": "monthly_ref_salary" },
--     { "above_years": 10, "rate": 0.3333, "basis": "monthly_ref_salary" }
--   ],
--   "min_seniority_months": 8,
--   "ref_salary": "max(avg_12m, avg_3m_with_bonus_prorata)"
-- }

-- ─── 4. Barèmes conventionnels par IDCC ────────────────────────────────────

CREATE TABLE IF NOT EXISTS convention_indemnity_scales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idcc            text NOT NULL,                   -- code IDCC (ex: "1486" pour Syntec)
  convention_name text NOT NULL,
  type            text NOT NULL,                   -- licenciement, preavis, conges, prime_anciennete
  category        text,                            -- cadre, non-cadre, ETAM, etc. (NULL = tous)
  formula_json    jsonb NOT NULL,                  -- même format que indemnity_formulas
  conditions_json jsonb DEFAULT '{}',
  source_ref      text,                            -- "Avenant du 15/03/2024 étendu par arrêté..."
  valid_from      date NOT NULL,
  valid_to        date,
  created_at      timestamptz DEFAULT now(),

  CONSTRAINT uq_conv_scale_period UNIQUE (idcc, type, category, valid_from)
);

CREATE INDEX idx_conv_scales_idcc ON convention_indemnity_scales (idcc, type) WHERE valid_to IS NULL;

COMMENT ON TABLE convention_indemnity_scales IS 'Barèmes conventionnels d''indemnités par IDCC. Permet la comparaison légal vs conventionnel (principe de faveur).';

-- ─── 5. Délais de prescription ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prescription_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,                   -- salaires, licenciement_contestation, discrimination, harcelement, etc.
  label           text NOT NULL,
  duration_value  integer NOT NULL,                -- ex: 3
  duration_unit   text NOT NULL,                   -- years, months, days
  starting_point  text NOT NULL,                   -- ex: "date de notification du licenciement"
  source_ref      text NOT NULL,
  source_url      text,
  notes           text,
  valid_from      date NOT NULL,
  valid_to        date,
  created_at      timestamptz DEFAULT now(),

  CONSTRAINT uq_prescription_period UNIQUE (type, valid_from)
);

COMMENT ON TABLE prescription_periods IS 'Délais de prescription par type de litige, avec point de départ et référence légale.';

-- ─── 6. Historique des calculs (audit trail) ────────────────────────────────

CREATE TABLE IF NOT EXISTS calculation_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  user_id         uuid NOT NULL,
  dossier_id      uuid REFERENCES dossiers(id),
  calculation_type text NOT NULL,                  -- licenciement, rupture_conv, preavis, etc.
  input_params    jsonb NOT NULL,                  -- paramètres saisis
  result_json     jsonb NOT NULL,                  -- résultat détaillé
  legal_refs      text[] DEFAULT '{}',             -- articles cités
  baremes_used    jsonb DEFAULT '{}',              -- snapshot des barèmes utilisés (traçabilité)
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_calc_history_tenant ON calculation_history (tenant_id, created_at DESC);
CREATE INDEX idx_calc_history_dossier ON calculation_history (dossier_id) WHERE dossier_id IS NOT NULL;

-- RLS
ALTER TABLE calculation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calc_history_tenant_isolation" ON calculation_history
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE calculation_history IS 'Historique de tous les calculs effectués. Stocke un snapshot des barèmes utilisés pour traçabilité juridique.';

-- ─── 7. Journal des mises à jour de barèmes ────────────────────────────────

CREATE TABLE IF NOT EXISTS bareme_update_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name      text NOT NULL,                   -- reference_values, macron_scale, etc.
  record_id       uuid NOT NULL,
  action          text NOT NULL,                   -- insert, update, close (valid_to set)
  old_value       jsonb,
  new_value       jsonb NOT NULL,
  updated_by      text NOT NULL,                   -- admin:uuid | cron | agent:run_id
  source          text,                            -- URL ou référence du texte officiel
  verified        boolean DEFAULT false,           -- validé par un humain ?
  verified_by     uuid,
  verified_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_bareme_log_table ON bareme_update_log (table_name, created_at DESC);

COMMENT ON TABLE bareme_update_log IS 'Audit trail de toutes les modifications de barèmes. Chaque changement est tracé avec sa source.';

-- ─── 8. Fonction helper : récupérer la valeur active à une date ─────────────

CREATE OR REPLACE FUNCTION get_reference_value(p_key text, p_date date DEFAULT CURRENT_DATE)
RETURNS numeric
LANGUAGE sql STABLE
AS $$
  SELECT value FROM reference_values
  WHERE key = p_key
    AND valid_from <= p_date
    AND (valid_to IS NULL OR valid_to >= p_date)
  ORDER BY valid_from DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_reference_value IS 'Retourne la valeur de référence active à la date donnée (défaut: aujourd''hui).';

-- ─── 9. Fonction helper : récupérer le barème Macron ────────────────────────

CREATE OR REPLACE FUNCTION get_macron_scale(
  p_seniority_years integer,
  p_company_size text DEFAULT 'standard',
  p_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(min_months numeric, max_months numeric)
LANGUAGE sql STABLE
AS $$
  SELECT min_months, max_months FROM macron_scale
  WHERE seniority_years = LEAST(p_seniority_years, 30) -- plafonné à 30 ans dans le barème
    AND company_size = p_company_size
    AND valid_from <= p_date
    AND (valid_to IS NULL OR valid_to >= p_date)
  ORDER BY valid_from DESC
  LIMIT 1;
$$;

-- ─── 10. Fonction helper : comparer légal vs conventionnel ──────────────────

CREATE OR REPLACE FUNCTION get_applicable_formula(
  p_type text,
  p_idcc text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(source text, formula jsonb, conditions jsonb, ref text)
LANGUAGE sql STABLE
AS $$
  -- Retourne d'abord le légal, puis le conventionnel si applicable
  -- L'appelant compare et applique le principe de faveur

  SELECT 'legal' as source, formula_json, conditions_json, source_ref
  FROM indemnity_formulas
  WHERE type = p_type
    AND valid_from <= p_date
    AND (valid_to IS NULL OR valid_to >= p_date)
  ORDER BY valid_from DESC
  LIMIT 1

  UNION ALL

  SELECT 'conventionnel' as source, formula_json, conditions_json, source_ref
  FROM convention_indemnity_scales
  WHERE idcc = p_idcc
    AND type = p_type
    AND (category IS NULL OR category = p_category)
    AND valid_from <= p_date
    AND (valid_to IS NULL OR valid_to >= p_date)
  ORDER BY valid_from DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_applicable_formula IS 'Retourne les formules légale ET conventionnelle pour un type d''indemnité. L''appelant applique le principe de faveur (le + favorable au salarié).';
