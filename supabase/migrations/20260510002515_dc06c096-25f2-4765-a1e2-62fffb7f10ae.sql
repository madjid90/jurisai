ALTER TABLE public.legal_sources
  DROP CONSTRAINT IF EXISTS legal_sources_source_type_check;

ALTER TABLE public.legal_sources
  ADD CONSTRAINT legal_sources_source_type_check CHECK (
    source_type IN (
      'code_travail','convention_collective','jurisprudence','urssaf','rgpd',
      'accord_branche','jo','autre','code_article','convention','loi','decret',
      'circulaire','arrete','bofip','cdtn_modele','service_public','cnil',
      'cdtn_question','accord_entreprise','dossier_legislatif',
      'cnil_traitement','cnil_doctrine'
    )
  );

CREATE INDEX IF NOT EXISTS idx_legal_sources_connector_active
  ON public.legal_sources(connector, source_type)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_legal_sources_legal_date
  ON public.legal_sources(legal_date DESC NULLS LAST)
  WHERE is_active = true AND legal_date IS NOT NULL;

CREATE OR REPLACE VIEW public.v_legal_sources_summary AS
SELECT
  connector,
  source_type,
  count(*) AS total_sources,
  count(*) FILTER (WHERE is_active) AS active_sources,
  max(updated_at) AS last_update,
  min(created_at) AS first_ingested
FROM public.legal_sources
GROUP BY connector, source_type
ORDER BY connector, source_type;

COMMENT ON VIEW public.v_legal_sources_summary IS
  'Synthèse par connecteur/source_type : sert au monitoring d''ingestion (admin).';