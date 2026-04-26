-- ============ CLIENTS ============
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  job_title text,
  contract_type text,
  hire_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_tenant ON public.clients(tenant_id);
CREATE INDEX idx_clients_name ON public.clients(tenant_id, full_name);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant clients"
  ON public.clients FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Members create clients in their tenant"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Creator or admin updates clients"
  ON public.clients FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE POLICY "Creator or admin deletes clients"
  ON public.clients FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ DOSSIERS ============
CREATE TABLE public.dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_by uuid NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'autre',
  status text NOT NULL DEFAULT 'open',
  risk_level text NOT NULL DEFAULT 'low',
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dossiers_status_chk CHECK (status IN ('open','in_progress','closed')),
  CONSTRAINT dossiers_risk_chk CHECK (risk_level IN ('low','medium','high'))
);

CREATE INDEX idx_dossiers_tenant ON public.dossiers(tenant_id);
CREATE INDEX idx_dossiers_client ON public.dossiers(client_id);
CREATE INDEX idx_dossiers_status ON public.dossiers(tenant_id, status);

ALTER TABLE public.dossiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant dossiers"
  ON public.dossiers FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Members create dossiers in their tenant"
  ON public.dossiers FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Creator or admin updates dossiers"
  ON public.dossiers FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE POLICY "Creator or admin deletes dossiers"
  ON public.dossiers FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE TRIGGER trg_dossiers_updated_at
  BEFORE UPDATE ON public.dossiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ DOSSIER DEADLINES ============
CREATE TABLE public.dossier_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  title text NOT NULL,
  description text,
  due_date timestamptz NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deadlines_dossier ON public.dossier_deadlines(dossier_id);
CREATE INDEX idx_deadlines_tenant_due ON public.dossier_deadlines(tenant_id, due_date) WHERE completed = false;

ALTER TABLE public.dossier_deadlines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant deadlines"
  ON public.dossier_deadlines FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Members create deadlines in their tenant"
  ON public.dossier_deadlines FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Creator or admin updates deadlines"
  ON public.dossier_deadlines FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE POLICY "Creator or admin deletes deadlines"
  ON public.dossier_deadlines FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE TRIGGER trg_deadlines_updated_at
  BEFORE UPDATE ON public.dossier_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();