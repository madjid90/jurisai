-- ─── 1. Étendre le CHECK source_type ───────────────────────────────────────
ALTER TABLE public.legal_sources
  DROP CONSTRAINT IF EXISTS legal_sources_source_type_check;

ALTER TABLE public.legal_sources
  ADD CONSTRAINT legal_sources_source_type_check CHECK (
    source_type IN (
      'code_travail','convention_collective','jurisprudence','urssaf','rgpd',
      'accord_branche','jo','autre','code_article','convention','loi','decret',
      'circulaire','arrete','bofip','cdtn_modele','service_public','cnil',
      'cdtn_question','dossier_legislatif','accord_entreprise','cnil_doctrine',
      'code_section','jurisprudence_admin',
      'convention_article','doctrine_fiscale','jurisprudence_administrative',
      'modele_courrier','fiche_service_public','fiche_ministere_travail',
      'cnil_sanction','cnil_deliberation','fiche_pratique','contribution'
    )
  );

-- ─── 2. Élargir authority_level 0..100 ─────────────────────────────────────
ALTER TABLE public.legal_sources
  DROP CONSTRAINT IF EXISTS legal_sources_authority_level_check;

ALTER TABLE public.legal_sources
  ADD CONSTRAINT legal_sources_authority_level_check
    CHECK (authority_level BETWEEN 0 AND 100);

ALTER TABLE public.legal_sources
  ALTER COLUMN authority_level SET DEFAULT 50;

-- ─── 3. Réécriture trigger ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_authority_level()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.authority_level IS NOT NULL AND NEW.authority_level > 0 THEN
    RETURN NEW;
  END IF;

  NEW.authority_level := CASE NEW.source_type
    WHEN 'code_article'                THEN 100
    WHEN 'code_section'                THEN 100
    WHEN 'code_travail'                THEN 100
    WHEN 'loi'                         THEN 100
    WHEN 'decret'                      THEN 95
    WHEN 'arrete'                      THEN 90
    WHEN 'circulaire'                  THEN 85
    WHEN 'jurisprudence'               THEN 90
    WHEN 'jurisprudence_admin'         THEN 88
    WHEN 'jurisprudence_administrative' THEN 88
    WHEN 'convention'                  THEN 85
    WHEN 'convention_article'          THEN 85
    WHEN 'convention_collective'       THEN 85
    WHEN 'accord_branche'              THEN 80
    WHEN 'accord_entreprise'           THEN 70
    WHEN 'bofip'                       THEN 80
    WHEN 'doctrine_fiscale'            THEN 80
    WHEN 'cnil'                        THEN 75
    WHEN 'cnil_doctrine'               THEN 75
    WHEN 'cnil_deliberation'           THEN 75
    WHEN 'cnil_sanction'               THEN 75
    WHEN 'cdtn_question'               THEN 60
    WHEN 'contribution'                THEN 60
    WHEN 'service_public'              THEN 50
    WHEN 'fiche_service_public'        THEN 50
    WHEN 'fiche_ministere_travail'    THEN 55
    WHEN 'fiche_pratique'              THEN 50
    WHEN 'dossier_legislatif'          THEN 40
    WHEN 'cdtn_modele'                 THEN 30
    WHEN 'modele_courrier'             THEN 30
    WHEN 'urssaf'                      THEN 70
    WHEN 'rgpd'                        THEN 75
    WHEN 'jo'                          THEN 60
    WHEN 'autre'                       THEN 50
    ELSE 50
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_authority_level() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_authority_level() TO service_role;

DROP TRIGGER IF EXISTS trg_compute_authority_level ON public.legal_sources;
CREATE TRIGGER trg_compute_authority_level
BEFORE INSERT OR UPDATE OF source_type ON public.legal_sources
FOR EACH ROW
EXECUTE FUNCTION public.compute_authority_level();

-- ─── 4. Backfill ───────────────────────────────────────────────────────────
UPDATE public.legal_sources
SET authority_level = 0
WHERE authority_level IS NULL OR authority_level <= 6;
-- Le trigger BEFORE UPDATE OF source_type ne se déclenche pas ici, on force :
UPDATE public.legal_sources
SET source_type = source_type
WHERE authority_level = 0;

-- ─── 5. Vue de validation ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_source_types_health AS
SELECT
  source_type,
  count(*) AS rows_count,
  count(*) FILTER (WHERE is_active) AS active_rows,
  min(authority_level) AS min_authority,
  max(authority_level) AS max_authority,
  avg(authority_level)::int AS avg_authority
FROM public.legal_sources
GROUP BY source_type
ORDER BY avg_authority DESC NULLS LAST;

GRANT SELECT ON public.v_source_types_health TO authenticated;