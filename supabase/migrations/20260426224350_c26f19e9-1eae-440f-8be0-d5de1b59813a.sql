CREATE TABLE public.document_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  filename text NOT NULL,
  file_type text NOT NULL,
  file_size integer NOT NULL,
  extracted_text text,
  analysis jsonb,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  tokens_used integer,
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analyses_status_chk CHECK (status IN ('pending', 'completed', 'failed')),
  CONSTRAINT analyses_filetype_chk CHECK (file_type IN ('pdf', 'docx'))
);

CREATE INDEX idx_analyses_tenant ON public.document_analyses(tenant_id, created_at DESC);
CREATE INDEX idx_analyses_dossier ON public.document_analyses(dossier_id);

ALTER TABLE public.document_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant analyses"
  ON public.document_analyses FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Members create analyses in their tenant"
  ON public.document_analyses FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Owner or admin updates analyses"
  ON public.document_analyses FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE POLICY "Owner or admin deletes analyses"
  ON public.document_analyses FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE TRIGGER trg_analyses_updated_at
  BEFORE UPDATE ON public.document_analyses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();