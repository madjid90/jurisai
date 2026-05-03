
-- Table des échéances extraites depuis les contrats analysés par l'agent
CREATE TABLE IF NOT EXISTS public.contract_deadlines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_analysis_id UUID REFERENCES public.document_analyses(id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  dossier_id UUID REFERENCES public.dossiers(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  due_date DATE NOT NULL,
  category TEXT,
  notes TEXT,
  reminded_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_deadlines_tenant_due ON public.contract_deadlines(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_contract_deadlines_due ON public.contract_deadlines(due_date) WHERE done_at IS NULL;

ALTER TABLE public.contract_deadlines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read deadlines"
  ON public.contract_deadlines FOR SELECT
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "members write deadlines"
  ON public.contract_deadlines FOR INSERT
  WITH CHECK (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "members update deadlines"
  ON public.contract_deadlines FOR UPDATE
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE TRIGGER trg_contract_deadlines_updated
  BEFORE UPDATE ON public.contract_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
