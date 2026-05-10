-- LOT 5 RAG : index des références juridiques pour vérification post-réponse.
-- Vue dérivée de legal_sources (pas de stockage redondant).
-- Normalise reference_code (espaces, ponctuation, casse) pour matching rapide.

CREATE OR REPLACE VIEW public.legal_reference_index AS
SELECT
  ls.id AS source_id,
  ls.title,
  ls.source_type,
  ls.reference_code,
  ls.official_url,
  ls.idcc,
  -- Forme normalisée : minuscule, espaces compactés, ponctuation simplifiée
  lower(regexp_replace(coalesce(ls.reference_code, ''), '[\s\.\-]+', '', 'g')) AS reference_norm
FROM public.legal_sources ls
WHERE ls.is_active = true
  AND ls.reference_code IS NOT NULL
  AND length(ls.reference_code) > 0;

COMMENT ON VIEW public.legal_reference_index IS
  'LOT 5 RAG — Index des références juridiques actives pour vérification post-réponse des citations [source:N].';

-- Index fonctionnel sur la table sous-jacente pour accélérer les lookups normalisés
CREATE INDEX IF NOT EXISTS idx_legal_sources_reference_norm
  ON public.legal_sources (
    (lower(regexp_replace(coalesce(reference_code, ''), '[\s\.\-]+', '', 'g')))
  )
  WHERE is_active = true AND reference_code IS NOT NULL;

-- Permissions : lecture pour authenticated et service_role
GRANT SELECT ON public.legal_reference_index TO authenticated, service_role;