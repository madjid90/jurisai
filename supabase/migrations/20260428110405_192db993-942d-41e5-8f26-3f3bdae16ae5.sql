
DROP FUNCTION IF EXISTS public.hybrid_search(vector, text, integer, text, integer);

CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding vector,
  query_text text,
  match_count integer DEFAULT 8,
  idcc_filter text DEFAULT NULL,
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
  embedding vector(1536)
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
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
    SELECT chunk_id, SUM(1.0 / (rrf_k + rank))::real AS rrf_score
    FROM (
      SELECT chunk_id, rank FROM vector_search
      UNION ALL
      SELECT chunk_id, rank FROM fts_search
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
$$;

-- FK manquantes
DO $$ BEGIN
  ALTER TABLE message_feedback ADD CONSTRAINT message_feedback_message_fk
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE message_feedback ADD CONSTRAINT message_feedback_user_fk
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE message_feedback ADD CONSTRAINT message_feedback_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE rag_eval_runs ADD CONSTRAINT rag_eval_runs_case_fk
    FOREIGN KEY (case_id) REFERENCES rag_eval_cases(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE legal_article_versions ADD CONSTRAINT legal_article_versions_source_fk
    FOREIGN KEY (source_id) REFERENCES legal_sources(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing_events ADD CONSTRAINT billing_events_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Mode RAG
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS rag_mode text DEFAULT 'strict'
    CHECK (rag_mode IN ('strict', 'assisted', 'brouillon'));
COMMENT ON COLUMN tenants.rag_mode IS
  'strict=refuse sans source, assisted=général avec warning, brouillon=libre';

-- Staging table
CREATE TABLE IF NOT EXISTS legal_chunks_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  source_id uuid NOT NULL,
  chunk_index int NOT NULL,
  heading text,
  content text NOT NULL,
  embedding vector(1536),
  token_count int,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staging_job ON legal_chunks_staging(job_id);
ALTER TABLE legal_chunks_staging ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Super admin manage staging" ON legal_chunks_staging
    FOR ALL TO authenticated
    USING (is_super_admin(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION promote_ingestion_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_id uuid;
  v_staging_count int;
  v_with_emb int;
BEGIN
  SELECT source_id INTO v_source_id FROM ingestion_jobs WHERE id = p_job_id;
  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'Job % has no source', p_job_id;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE embedding IS NOT NULL)
  INTO v_staging_count, v_with_emb
  FROM legal_chunks_staging WHERE job_id = p_job_id;

  IF v_staging_count = 0 THEN
    RAISE EXCEPTION 'No chunks in staging for job %', p_job_id;
  END IF;
  IF v_with_emb < v_staging_count THEN
    RAISE EXCEPTION 'Embeddings missing: % of %', v_staging_count - v_with_emb, v_staging_count;
  END IF;

  DELETE FROM legal_chunks WHERE source_id = v_source_id;
  INSERT INTO legal_chunks (source_id, chunk_index, heading, content, embedding)
  SELECT source_id, chunk_index, heading, content, embedding
  FROM legal_chunks_staging WHERE job_id = p_job_id;

  DELETE FROM legal_chunks_staging WHERE job_id = p_job_id;

  UPDATE ingestion_jobs SET status='completed', completed_at=now() WHERE id = p_job_id;

  RETURN jsonb_build_object('job_id', p_job_id, 'source_id', v_source_id, 'chunks_promoted', v_staging_count);
END $$;

REVOKE EXECUTE ON FUNCTION promote_ingestion_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promote_ingestion_job(uuid) TO service_role;
