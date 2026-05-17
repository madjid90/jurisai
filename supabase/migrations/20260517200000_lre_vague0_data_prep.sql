-- Vague 0 du Legal Reasoning Engine (LRE) — Préparation data.
--
-- Objectif : la couche LRE va filtrer les sources par legal_date (loi en vigueur
-- à la date des faits) et faire de l'exact-match de citation. Avant de déployer
-- le reasoner, il faut que la base soit propre :
--   1. legal_date renseignée sur tout le corpus (était à 40,7 %)
--   2. hybrid_search performant (précalcul tsquery)
--   3. rag_eval_cases : colonnes de validation manuelle
--
-- Migrations DÉJÀ APPLIQUÉES via Supabase MCP — ce fichier sert de référence git.

-- ─── 1. Helper parse_french_date ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.parse_french_date(input text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  cleaned text;
  m text[];
  month_num int;
  day_num int;
  year_num int;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  cleaned := regexp_replace(input, '(\d)er\s', '\1 ', 'g');
  m := regexp_match(cleaned, '(\d{1,2})\s+([a-zA-ZéûôîàèçÉÛÔÎÀÈÇ]+)\s+(\d{4})');
  IF m IS NULL THEN RETURN NULL; END IF;
  day_num := m[1]::int;
  year_num := m[3]::int;
  month_num := CASE lower(m[2])
    WHEN 'janvier' THEN 1
    WHEN 'février' THEN 2 WHEN 'fevrier' THEN 2
    WHEN 'mars' THEN 3 WHEN 'avril' THEN 4 WHEN 'mai' THEN 5 WHEN 'juin' THEN 6
    WHEN 'juillet' THEN 7
    WHEN 'août' THEN 8 WHEN 'aout' THEN 8
    WHEN 'septembre' THEN 9 WHEN 'octobre' THEN 10 WHEN 'novembre' THEN 11
    WHEN 'décembre' THEN 12 WHEN 'decembre' THEN 12
    ELSE NULL
  END;
  IF month_num IS NULL THEN RETURN NULL; END IF;
  IF day_num < 1 OR day_num > 31 THEN RETURN NULL; END IF;
  IF year_num < 1900 OR year_num > 2100 THEN RETURN NULL; END IF;
  BEGIN
    RETURN make_date(year_num, month_num, day_num);
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
END;
$$;

COMMENT ON FUNCTION public.parse_french_date(text) IS
  'Parse une chaîne contenant une date française "JJ mois AAAA" (avec gestion de "1er") et retourne la 1re date trouvée.';

-- ─── 2. Backfill legal_date sur conventions (KALI regex titre) ──────────────
-- 100 % des 55 947 conventions ont leur date dans le titre.
UPDATE legal_sources
SET legal_date = parse_french_date(title)
WHERE source_type = 'convention_article'
  AND legal_date IS NULL
  AND parse_french_date(title) IS NOT NULL;

-- ─── 3. Backfill legal_date proxy created_at pour sources sans date juridique ──
-- Concernés : fiches Service-Public, fiches Ministère, accords entreprise (API ACCO
-- n'expose pas la date), modèles de courrier.
UPDATE legal_sources
SET legal_date = created_at::date
WHERE source_type IN ('fiche_service_public','fiche_ministere_travail','accord_entreprise','modele_courrier')
  AND legal_date IS NULL
  AND created_at IS NOT NULL;

-- ─── 4. Optimisation hybrid_search : précalcul du tsquery ──────────────────
DROP FUNCTION IF EXISTS public.hybrid_search(vector, text, integer, text, integer);

CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding vector,
  query_text text,
  match_count integer DEFAULT 8,
  idcc_filter text DEFAULT NULL::text,
  rrf_k integer DEFAULT 60
)
RETURNS TABLE(
  chunk_id uuid, source_id uuid, content text, heading text,
  source_title text, source_type text, reference_code text, official_url text, score real
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_idcc_clause text;
  v_tsq tsquery;
BEGIN
  v_tsq := websearch_to_tsquery('french', query_text);
  v_idcc_clause := CASE WHEN idcc_filter IS NULL THEN 'TRUE'
                        ELSE format('(s.idcc IS NULL OR s.idcc = %L)', idcc_filter) END;
  RETURN QUERY EXECUTE format($q$
    WITH vector_raw AS (
      SELECT c.id AS chunk_id, c.source_id FROM public.legal_chunks c
      WHERE c.embedding IS NOT NULL
      ORDER BY c.embedding <=> %L::vector LIMIT %s
    ),
    vector_search AS (
      SELECT vr.chunk_id, row_number() OVER () AS rank
      FROM vector_raw vr JOIN public.legal_sources s ON s.id = vr.source_id
      WHERE s.is_active AND %s LIMIT %s
    ),
    fts_search AS (
      SELECT c.id AS chunk_id, row_number() OVER (ORDER BY ts_rank_cd(c.fts, %L::tsquery) DESC) AS rank
      FROM public.legal_chunks c JOIN public.legal_sources s ON s.id = c.source_id
      WHERE s.is_active AND %s AND c.fts @@ %L::tsquery
      ORDER BY ts_rank_cd(c.fts, %L::tsquery) DESC LIMIT %s
    ),
    combined AS (
      SELECT chunk_id, SUM(weight / (%s + rank))::real AS rrf_score
      FROM (
        SELECT chunk_id, rank, 0.9::real AS weight FROM vector_search
        UNION ALL SELECT chunk_id, rank, 1.0::real AS weight FROM fts_search
      ) u GROUP BY chunk_id
    )
    SELECT c.id, c.source_id, c.content, c.heading, s.title, s.source_type,
           s.reference_code, s.official_url,
           (co.rrf_score * CASE
             WHEN COALESCE(s.authority_level, 50) >= 95 THEN 1.50
             WHEN COALESCE(s.authority_level, 50) >= 85 THEN 1.30
             WHEN COALESCE(s.authority_level, 50) >= 70 THEN 1.15
             WHEN COALESCE(s.authority_level, 50) >= 50 THEN 1.00
             WHEN COALESCE(s.authority_level, 50) >= 30 THEN 0.90
             ELSE 0.80 END)::real AS score
    FROM combined co JOIN public.legal_chunks c ON c.id = co.chunk_id
    JOIN public.legal_sources s ON s.id = c.source_id
    ORDER BY score DESC LIMIT %s
  $q$,
    query_embedding, match_count * 8,
    v_idcc_clause, match_count * 4,
    v_tsq, v_idcc_clause, v_tsq, v_tsq, match_count * 4,
    rrf_k, match_count * 2);
END;
$function$;

-- ─── 5. Colonnes de validation des cas eval ─────────────────────────────────
ALTER TABLE rag_eval_cases
  ADD COLUMN IF NOT EXISTS validated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS validated_by uuid,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE INDEX IF NOT EXISTS idx_eval_cases_validated ON rag_eval_cases(validated, active);

COMMENT ON COLUMN rag_eval_cases.validated IS
  'Cas validé manuellement par un super_admin. Seuls les cas validated=true comptent dans les métriques d''eval V2 (LRE).';
