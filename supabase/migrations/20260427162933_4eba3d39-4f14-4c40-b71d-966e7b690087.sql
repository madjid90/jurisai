-- ─── Helper function ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  );
$$;

-- ─── legal_sources ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.legal_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'code_travail','convention_collective','jurisprudence',
    'urssaf','rgpd','accord_branche','jo','autre'
  )),
  reference_code text,
  official_url text,
  idcc text,
  version_date date,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legal_sources_type ON public.legal_sources(source_type) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_legal_sources_idcc ON public.legal_sources(idcc) WHERE idcc IS NOT NULL;

-- ─── legal_chunks ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.legal_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.legal_sources(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  heading text,
  embedding vector(1536),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('french', coalesce(heading,'') || ' ' || content)) STORED,
  token_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_source ON public.legal_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_fts ON public.legal_chunks USING gin(fts);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_embedding ON public.legal_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ─── ingestion_jobs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.legal_sources(id) ON DELETE SET NULL,
  job_type text NOT NULL CHECK (job_type IN ('url_import','text_import','re_embed')),
  input_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  chunks_created integer NOT NULL DEFAULT 0,
  error_message text,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON public.ingestion_jobs(status, created_at DESC);

-- ─── chat_citations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL REFERENCES public.legal_chunks(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  rank integer NOT NULL DEFAULT 0,
  score real,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_citations_message ON public.chat_citations(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_citations_tenant ON public.chat_citations(tenant_id);

-- ─── Triggers ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_updated_at_legal_sources ON public.legal_sources;
CREATE TRIGGER set_updated_at_legal_sources
  BEFORE UPDATE ON public.legal_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.legal_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read active sources"
  ON public.legal_sources FOR SELECT TO authenticated
  USING (is_active = true OR public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin insert sources"
  ON public.legal_sources FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin update sources"
  ON public.legal_sources FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin delete sources"
  ON public.legal_sources FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Authenticated read chunks"
  ON public.legal_chunks FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Super admin manage chunks"
  ON public.legal_chunks FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin read jobs"
  ON public.ingestion_jobs FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin insert jobs"
  ON public.ingestion_jobs FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) AND triggered_by = auth.uid());

CREATE POLICY "Super admin update jobs"
  ON public.ingestion_jobs FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Members view tenant citations"
  ON public.chat_citations FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

-- ─── Hybrid search function ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding vector(1536),
  query_text text,
  match_count integer DEFAULT 8,
  idcc_filter text DEFAULT NULL,
  rrf_k integer DEFAULT 60
)
RETURNS TABLE (
  chunk_id uuid,
  source_id uuid,
  content text,
  heading text,
  source_title text,
  source_type text,
  reference_code text,
  official_url text,
  score real
)
LANGUAGE sql
STABLE
SET search_path = public
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
    SELECT chunk_id, SUM(1.0 / (rrf_k + rank))::real AS score
    FROM (
      SELECT chunk_id, rank FROM vector_search
      UNION ALL
      SELECT chunk_id, rank FROM fts_search
    ) u
    GROUP BY chunk_id
  )
  SELECT c.id, c.source_id, c.content, c.heading,
         s.title, s.source_type, s.reference_code, s.official_url,
         co.score
  FROM combined co
  JOIN public.legal_chunks c ON c.id = co.chunk_id
  JOIN public.legal_sources s ON s.id = c.source_id
  ORDER BY co.score DESC
  LIMIT match_count;
$$;

-- ─── Mark demo user as super_admin ───────────────────────────────────────────
INSERT INTO public.user_roles (user_id, tenant_id, role)
SELECT p.id,
       coalesce(p.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
       'super_admin'::app_role
FROM public.profiles p
WHERE p.email = 'demo@jurisai.test'
ON CONFLICT (user_id, tenant_id, role) DO NOTHING;