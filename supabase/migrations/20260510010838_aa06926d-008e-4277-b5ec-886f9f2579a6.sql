-- ============================================================================
-- Système d'ingestion batch + checkpoint pour open data juridique COMPLET
-- ============================================================================

-- ─── 1. Étendre source_type ─────────────────────────────────────────────────
ALTER TABLE public.legal_sources
  DROP CONSTRAINT IF EXISTS legal_sources_source_type_check;

ALTER TABLE public.legal_sources
  ADD CONSTRAINT legal_sources_source_type_check CHECK (
    source_type IN (
      'code_travail', 'convention_collective', 'jurisprudence',
      'urssaf', 'rgpd', 'accord_branche', 'jo', 'autre',
      'code_article', 'convention', 'loi', 'decret',
      'circulaire', 'arrete', 'bofip', 'cdtn_modele',
      'service_public', 'cnil',
      'cdtn_question', 'dossier_legislatif',
      'accord_entreprise', 'cnil_doctrine',
      'code_section', 'jurisprudence_admin'
    )
  );

-- ─── 2. Table de checkpoint ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ingestion_batch_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector text NOT NULL,
  batch_type text NOT NULL,
  total_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  processed_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  failed_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused')),
  total_count integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  articles_ingested integer NOT NULL DEFAULT 0,
  articles_skipped_unchanged integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_tick_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.ingestion_batch_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view batch state"
  ON public.ingestion_batch_state FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_batch_state_connector_status
  ON public.ingestion_batch_state(connector, status, last_tick_at DESC);

CREATE INDEX IF NOT EXISTS idx_batch_state_active
  ON public.ingestion_batch_state(connector, last_tick_at DESC)
  WHERE status IN ('running', 'pending');

COMMENT ON TABLE public.ingestion_batch_state IS
  'Checkpoint pour ingestion batch. Permet de reprendre où ça s''est arrêté.';

-- ─── 3. Index étendus sur legal_sources pour RAG fin ────────────────────────
CREATE INDEX IF NOT EXISTS idx_legal_sources_section_path_gin
  ON public.legal_sources USING gin ((raw_metadata->'section_path'));

CREATE INDEX IF NOT EXISTS idx_legal_sources_code_id
  ON public.legal_sources((raw_metadata->>'code_id'))
  WHERE raw_metadata ? 'code_id';

CREATE INDEX IF NOT EXISTS idx_legal_sources_etat
  ON public.legal_sources((raw_metadata->>'etat'))
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_legal_sources_content_hash
  ON public.legal_sources((raw_metadata->>'content_hash'))
  WHERE raw_metadata ? 'content_hash';

CREATE INDEX IF NOT EXISTS idx_legal_sources_chamber
  ON public.legal_sources((raw_metadata->>'chamber'))
  WHERE raw_metadata ? 'chamber';

CREATE INDEX IF NOT EXISTS idx_legal_sources_juridiction
  ON public.legal_sources((raw_metadata->>'juridiction'))
  WHERE raw_metadata ? 'juridiction';

-- ─── 4. Fonctions checkpoint ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_ingestion_batch(
  p_connector text,
  p_batch_type text,
  p_items jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid;
  v_existing_id uuid;
BEGIN
  SELECT id INTO v_existing_id
  FROM public.ingestion_batch_state
  WHERE connector = p_connector
    AND batch_type = p_batch_type
    AND status IN ('running', 'pending', 'paused')
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.ingestion_batch_state
    SET status = 'running', last_tick_at = now()
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.ingestion_batch_state (
    connector, batch_type, total_items, total_count, status, metadata
  ) VALUES (
    p_connector, p_batch_type, p_items,
    jsonb_array_length(p_items), 'running', p_metadata
  )
  RETURNING id INTO v_batch_id;

  RETURN v_batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_next_batch_items(
  p_batch_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total jsonb;
  v_processed jsonb;
  v_failed jsonb;
  v_remaining jsonb;
  v_chunk jsonb;
BEGIN
  SELECT total_items, processed_items, failed_items
  INTO v_total, v_processed, v_failed
  FROM public.ingestion_batch_state
  WHERE id = p_batch_id;

  IF v_total IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT jsonb_agg(item) INTO v_remaining
  FROM jsonb_array_elements(v_total) item
  WHERE NOT (v_processed @> jsonb_build_array(item))
    AND NOT (v_failed @> jsonb_build_array(item));

  IF v_remaining IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT jsonb_agg(item ORDER BY ord) INTO v_chunk
  FROM (
    SELECT item, ord
    FROM jsonb_array_elements(v_remaining) WITH ORDINALITY AS t(item, ord)
    ORDER BY ord
    LIMIT p_limit
  ) sub;

  RETURN COALESCE(v_chunk, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_items_processed(
  p_batch_id uuid,
  p_processed_items jsonb,
  p_articles_ingested integer DEFAULT 0,
  p_articles_skipped integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ingestion_batch_state
  SET
    processed_items = processed_items || p_processed_items,
    processed_count = processed_count + jsonb_array_length(p_processed_items),
    articles_ingested = articles_ingested + p_articles_ingested,
    articles_skipped_unchanged = articles_skipped_unchanged + p_articles_skipped,
    last_tick_at = now()
  WHERE id = p_batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_items_failed(
  p_batch_id uuid,
  p_failed_items jsonb,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_error_entry jsonb;
BEGIN
  v_error_entry := jsonb_build_object(
    'at', now(),
    'items', p_failed_items,
    'message', p_error_message
  );

  UPDATE public.ingestion_batch_state
  SET
    failed_items = failed_items || p_failed_items,
    failed_count = failed_count + jsonb_array_length(p_failed_items),
    error_log = (
      CASE
        WHEN jsonb_array_length(error_log) >= 50
        THEN (error_log - 0) || jsonb_build_array(v_error_entry)
        ELSE error_log || jsonb_build_array(v_error_entry)
      END
    ),
    last_tick_at = now()
  WHERE id = p_batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state record;
  v_final_status text;
BEGIN
  SELECT * INTO v_state
  FROM public.ingestion_batch_state
  WHERE id = p_batch_id;

  IF v_state.processed_count + v_state.failed_count >= v_state.total_count THEN
    v_final_status := CASE
      WHEN v_state.failed_count >= v_state.total_count THEN 'failed'
      WHEN v_state.processed_count > 0 THEN 'completed'
      ELSE 'failed'
    END;

    UPDATE public.ingestion_batch_state
    SET status = v_final_status,
        completed_at = now(),
        last_tick_at = now()
    WHERE id = p_batch_id;
  ELSE
    UPDATE public.ingestion_batch_state
    SET status = 'paused', last_tick_at = now()
    WHERE id = p_batch_id;
    v_final_status := 'paused';
  END IF;

  RETURN jsonb_build_object(
    'status', v_final_status,
    'processed', v_state.processed_count,
    'failed', v_state.failed_count,
    'total', v_state.total_count,
    'articles_ingested', v_state.articles_ingested
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_zombie_batches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH zombies AS (
    UPDATE public.ingestion_batch_state
    SET status = 'paused'
    WHERE status = 'running'
      AND last_tick_at < now() - interval '30 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM zombies;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_ingestion_batch(text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_next_batch_items(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_items_processed(uuid, jsonb, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_items_failed(uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_batch(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_zombie_batches() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.start_ingestion_batch(text, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_next_batch_items(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_items_processed(uuid, jsonb, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_items_failed(uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_batch(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_zombie_batches() TO service_role;

-- ─── 5. Vues monitoring ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_ingestion_progress AS
SELECT
  id AS batch_id,
  connector,
  batch_type,
  status,
  total_count,
  processed_count,
  failed_count,
  articles_ingested,
  articles_skipped_unchanged,
  CASE
    WHEN total_count = 0 THEN 0
    ELSE round(100.0 * (processed_count + failed_count) / total_count, 1)
  END AS percent_complete,
  started_at,
  last_tick_at,
  EXTRACT(EPOCH FROM (last_tick_at - started_at))::int AS elapsed_sec,
  CASE
    WHEN processed_count > 0 THEN
      EXTRACT(EPOCH FROM (last_tick_at - started_at))::int * (total_count - processed_count - failed_count) / processed_count
    ELSE NULL
  END AS estimated_remaining_sec,
  metadata
FROM public.ingestion_batch_state
ORDER BY last_tick_at DESC;

DROP VIEW IF EXISTS public.v_legal_sources_summary;
CREATE VIEW public.v_legal_sources_summary AS
SELECT
  connector,
  source_type,
  count(*) AS total_sources,
  count(*) FILTER (WHERE is_active) AS active_sources,
  count(*) FILTER (WHERE NOT is_active) AS inactive_sources,
  count(*) FILTER (WHERE raw_metadata ? 'content_hash') AS hashed_sources,
  count(DISTINCT raw_metadata->>'code_id')
    FILTER (WHERE raw_metadata ? 'code_id') AS distinct_codes,
  count(DISTINCT idcc) FILTER (WHERE idcc IS NOT NULL) AS distinct_idcc,
  max(updated_at) AS last_update,
  min(created_at) AS first_ingested
FROM public.legal_sources
GROUP BY connector, source_type
ORDER BY connector, source_type;

DROP VIEW IF EXISTS public.v_legal_chunks_summary;
CREATE VIEW public.v_legal_chunks_summary AS
SELECT
  ls.connector,
  ls.source_type,
  count(DISTINCT ls.id) AS sources_count,
  count(lc.id) AS chunks_count,
  avg(length(lc.content))::int AS avg_chunk_size,
  count(lc.id) FILTER (WHERE lc.embedding IS NOT NULL) AS embedded_chunks,
  count(lc.id) FILTER (WHERE lc.embedding IS NULL) AS missing_embeddings
FROM public.legal_sources ls
LEFT JOIN public.legal_chunks lc ON lc.source_id = ls.id
WHERE ls.is_active = true
GROUP BY ls.connector, ls.source_type
ORDER BY chunks_count DESC NULLS LAST;

GRANT SELECT ON public.v_ingestion_progress TO authenticated;
GRANT SELECT ON public.v_legal_sources_summary TO authenticated;
GRANT SELECT ON public.v_legal_chunks_summary TO authenticated;

-- ─── 6. Cleanup ancien connecteur kali (remplacé par kali-full) ─────────────
DELETE FROM public.legal_chunks
  WHERE source_id IN (SELECT id FROM public.legal_sources WHERE connector = 'kali');
DELETE FROM public.legal_chunks_staging
  WHERE source_id IN (SELECT id FROM public.legal_sources WHERE connector = 'kali');
DELETE FROM public.legal_sources WHERE connector = 'kali';