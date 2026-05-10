-- Trigger compute_authority_level : calcule auto le poids RAG selon source_type
CREATE OR REPLACE FUNCTION public.compute_authority_level()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only auto-compute when not explicitly set
  IF NEW.authority_level IS NOT NULL AND NEW.authority_level > 0 THEN
    RETURN NEW;
  END IF;

  NEW.authority_level := CASE NEW.source_type
    WHEN 'code_article'         THEN 100  -- Loi / code en vigueur
    WHEN 'loi'                  THEN 100
    WHEN 'decret'               THEN 95
    WHEN 'jurisprudence'        THEN 90  -- Cassation
    WHEN 'jurisprudence_admin'  THEN 88  -- Conseil d'État
    WHEN 'convention_collective' THEN 85
    WHEN 'convention_article'   THEN 85
    WHEN 'doctrine_fiscale'     THEN 80  -- BOFIP
    WHEN 'deliberation_cnil'    THEN 75
    WHEN 'sanction_cnil'        THEN 75
    WHEN 'accord_entreprise'    THEN 70
    WHEN 'contribution'         THEN 60  -- Q/R Ministère
    WHEN 'fiche_pratique'       THEN 50  -- Service-Public
    WHEN 'dossier_legislatif'   THEN 40  -- DOLE (en préparation)
    WHEN 'modele_courrier'      THEN 30
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

-- Backfill rows where authority_level is null/0
UPDATE public.legal_sources
SET source_type = source_type
WHERE authority_level IS NULL OR authority_level = 0;