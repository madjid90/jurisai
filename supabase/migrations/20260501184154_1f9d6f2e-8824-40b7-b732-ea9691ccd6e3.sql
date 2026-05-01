ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_dossier_id ON public.documents(dossier_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_dossier ON public.documents(tenant_id, dossier_id);