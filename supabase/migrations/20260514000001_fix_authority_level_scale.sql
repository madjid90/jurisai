-- Fix RAG authority_level scale mismatch
-- Problem: compute_authority_level uses 0-100 scale, but hybrid_search
-- expected 1-6 scale. All 97k+ sources stuck at authority_level=50 (ELSE default).
-- Fix: (1) Rewrite hybrid_search CASE to use 0-100 ranges, (2) Backfill all sources.

-- STEP 1: Replace hybrid_search to use the 0-100 authority_level scale
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding vector,
  query_text text,
  match_count integer DEFAULT 8,
  idcc_filter text DEFAULT NULL::text,
  rrf_k integer DEFAULT 60
)
RETURNS TABLE(
  chunk_id uuid,
  source_id uuid,
  content text,
  heading text,
  source_title text,
  source_type text,
  reference_code text,
  official_url text,
  score real,
  embedding vector
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  WITH vector_search AS (
    SELECT c.id AS chunk_id,
           row_number() OVER (ORDER BY c.embedding <=> query_embedding) AS rank
    FROM public.legal_chunks c
    JOIN public.legal_sources s ON s.id = c.source_id
    WHERE s.is_active
      AND (idcc_filter IS NULL OR s.idcc IS NULL OR s.idcc = idcc_filter)
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count * 4
  ),
  fts_search AS (
    SELECT c.id AS chunk_id,
           row_number() OVER (
             ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('french', query_text)) DESC
           ) AS rank
    FROM public.legal_chunks c
    JOIN public.legal_sources s ON s.id = c.source_id
    WHERE s.is_active
      AND (idcc_filter IS NULL OR s.idcc IS NULL OR s.idcc = idcc_filter)
      AND c.fts @@ websearch_to_tsquery('french', query_text)
    ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('french', query_text)) DESC
    LIMIT match_count * 4
  ),
  combined AS (
    -- R7 : facteur 0.9 sur la contribution vectorielle, 1.0 sur FTS
    SELECT chunk_id, SUM(weight / (rrf_k + rank))::real AS rrf_score
    FROM (
      SELECT chunk_id, rank, 0.9::real AS weight FROM vector_search
      UNION ALL
      SELECT chunk_id, rank, 1.0::real AS weight FROM fts_search
    ) u
    GROUP BY chunk_id
  )
  SELECT c.id, c.source_id, c.content, c.heading,
         s.title, s.source_type, s.reference_code, s.official_url,
         (co.rrf_score *
           -- Authority boost: 0-100 scale mapped to multipliers
           -- 95-100 = legislative/code (loi, code_article) → strongest boost
           -- 85-94  = regulatory/case law (decret, jurisprudence, convention) → strong boost
           -- 70-84  = doctrine/administrative (bofip, cnil, accord_branche) → moderate boost
           -- 50-69  = informational (fiches, contributions, jo) → neutral
           -- 30-49  = templates/practical (modeles, dossier_legislatif) → slight penalty
           -- 0-29   = low authority → penalty
           CASE
             WHEN COALESCE(s.authority_level, 50) >= 95 THEN 1.50
             WHEN COALESCE(s.authority_level, 50) >= 85 THEN 1.30
             WHEN COALESCE(s.authority_level, 50) >= 70 THEN 1.15
             WHEN COALESCE(s.authority_level, 50) >= 50 THEN 1.00
             WHEN COALESCE(s.authority_level, 50) >= 30 THEN 0.90
             ELSE 0.80
           END
         )::real AS score,
         c.embedding
  FROM combined co
  JOIN public.legal_chunks c ON c.id = co.chunk_id
  JOIN public.legal_sources s ON s.id = c.source_id
  ORDER BY score DESC
  LIMIT match_count * 2;
$function$;

-- STEP 2: Backfill authority_level on ALL existing sources
-- Reset all to 0 first so the trigger re-computes them
UPDATE public.legal_sources
SET authority_level = 0;

-- Now fire the trigger by touching the rows
-- The compute_authority_level trigger fires on INSERT OR UPDATE
-- and skips if authority_level > 0, so we just set to 0 above
UPDATE public.legal_sources
SET authority_level = CASE source_type
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
