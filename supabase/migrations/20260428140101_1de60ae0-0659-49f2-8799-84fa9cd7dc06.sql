-- Étendre les types acceptés pour legal_sources.source_type
ALTER TABLE public.legal_sources DROP CONSTRAINT IF EXISTS legal_sources_source_type_check;

ALTER TABLE public.legal_sources
  ADD CONSTRAINT legal_sources_source_type_check
  CHECK (source_type = ANY (ARRAY[
    -- legacy
    'code_travail','convention_collective','jurisprudence','urssaf','rgpd','accord_branche','jo','autre',
    -- nouveaux (alignés avec connecteurs)
    'code_article','convention','loi','decret','circulaire','arrete','bofip','cdtn_modele','service_public','cnil'
  ]));