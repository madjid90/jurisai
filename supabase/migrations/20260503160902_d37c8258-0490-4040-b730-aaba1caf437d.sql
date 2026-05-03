-- ========== document_links ==========
CREATE TABLE public.document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.document_analyses(id) ON DELETE CASCADE,
  dossier_id UUID NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  link_method TEXT NOT NULL CHECK (link_method IN ('auto','suggested','manual')),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_by UUID REFERENCES auth.users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_id, dossier_id)
);

CREATE INDEX idx_doclinks_tenant ON public.document_links(tenant_id);
CREATE INDEX idx_doclinks_doc ON public.document_links(document_id);
CREATE INDEX idx_doclinks_dossier ON public.document_links(dossier_id);
CREATE INDEX idx_doclinks_status ON public.document_links(tenant_id, status);

ALTER TABLE public.document_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doclinks_select_member" ON public.document_links
  FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "doclinks_insert_member" ON public.document_links
  FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "doclinks_update_member" ON public.document_links
  FOR UPDATE TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "doclinks_delete_admin" ON public.document_links
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id));

CREATE TRIGGER trg_doclinks_updated
  BEFORE UPDATE ON public.document_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== entity_mentions ==========
CREATE TABLE public.entity_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.document_analyses(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person','company','siren','siret','iban','email','phone','date','amount','dossier_ref','address','other')),
  raw_value TEXT NOT NULL,
  normalized_value TEXT,
  position_start INT,
  position_end INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entitymentions_tenant ON public.entity_mentions(tenant_id);
CREATE INDEX idx_entitymentions_doc ON public.entity_mentions(document_id);
CREATE INDEX idx_entitymentions_lookup ON public.entity_mentions(tenant_id, entity_type, normalized_value);

ALTER TABLE public.entity_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entitymentions_select_member" ON public.entity_mentions
  FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "entitymentions_insert_member" ON public.entity_mentions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "entitymentions_delete_admin" ON public.entity_mentions
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id));

-- ========== dossier_context_index ==========
CREATE TABLE public.dossier_context_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dossier_id UUID NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536),
  source_kind TEXT NOT NULL DEFAULT 'summary' CHECK (source_kind IN ('summary','title','party','document','note')),
  source_ref UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dossierctx_tenant ON public.dossier_context_index(tenant_id);
CREATE INDEX idx_dossierctx_dossier ON public.dossier_context_index(dossier_id);
CREATE INDEX idx_dossierctx_embedding ON public.dossier_context_index
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE public.dossier_context_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dossierctx_select_member" ON public.dossier_context_index
  FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "dossierctx_insert_member" ON public.dossier_context_index
  FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "dossierctx_delete_admin" ON public.dossier_context_index
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id));

CREATE TRIGGER trg_dossierctx_updated
  BEFORE UPDATE ON public.dossier_context_index
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== match_dossier_context (semantic search) ==========
CREATE OR REPLACE FUNCTION public.match_dossier_context(
  p_tenant_id UUID,
  p_embedding vector(1536),
  p_match_count INT DEFAULT 5,
  p_min_score REAL DEFAULT 0.70
)
RETURNS TABLE (
  dossier_id UUID,
  best_score REAL,
  matched_content TEXT,
  source_kind TEXT
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (dci.dossier_id)
    dci.dossier_id,
    (1 - (dci.embedding <=> p_embedding))::real AS best_score,
    dci.content AS matched_content,
    dci.source_kind
  FROM public.dossier_context_index dci
  WHERE dci.tenant_id = p_tenant_id
    AND dci.embedding IS NOT NULL
    AND (1 - (dci.embedding <=> p_embedding)) >= p_min_score
  ORDER BY dci.dossier_id, dci.embedding <=> p_embedding
  LIMIT p_match_count;
$$;

REVOKE EXECUTE ON FUNCTION public.match_dossier_context(UUID, vector, INT, REAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_dossier_context(UUID, vector, INT, REAL) TO service_role;