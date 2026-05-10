-- R2 : modèle IA configurable par tenant (stable par défaut)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS chat_model text NOT NULL DEFAULT 'google/gemini-2.5-flash';

-- R7 : pondérer le score sémantique × 0.9 dans la fusion RRF
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding vector,
  query_text text,
  match_count integer DEFAULT 8,
  idcc_filter text DEFAULT NULL::text,
  rrf_k integer DEFAULT 60
)
RETURNS TABLE(
  chunk_id uuid, source_id uuid, content text, heading text,
  source_title text, source_type text, reference_code text, official_url text,
  score real, embedding vector
)
LANGUAGE sql
STABLE
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
           CASE COALESCE(s.authority_level, 3)
             WHEN 1 THEN 1.50
             WHEN 2 THEN 1.30
             WHEN 3 THEN 1.15
             WHEN 4 THEN 1.05
             WHEN 5 THEN 1.00
             WHEN 6 THEN 0.85
             ELSE 1.00
           END
         )::real AS score,
         c.embedding
  FROM combined co
  JOIN public.legal_chunks c ON c.id = co.chunk_id
  JOIN public.legal_sources s ON s.id = c.source_id
  ORDER BY score DESC
  LIMIT match_count * 2;
$function$;