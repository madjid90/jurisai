CREATE OR REPLACE FUNCTION public.has_role_any_tenant(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;
REVOKE EXECUTE ON FUNCTION public.has_role_any_tenant(UUID, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role_any_tenant(UUID, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role_any_tenant(UUID, public.app_role) TO authenticated;

CREATE TABLE IF NOT EXISTS public.permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  module TEXT NOT NULL,
  description TEXT,
  is_technical BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permissions readable by authenticated" ON public.permissions;
CREATE POLICY "Permissions readable by authenticated"
  ON public.permissions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Permissions writable by super_admin" ON public.permissions;
CREATE POLICY "Permissions writable by super_admin"
  ON public.permissions FOR ALL TO authenticated
  USING (public.has_role_any_tenant(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role_any_tenant(auth.uid(), 'super_admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID,
  role public.app_role NOT NULL,
  permission_key TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  granted BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, role, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_lookup
  ON public.role_permissions (role, permission_key, tenant_id);
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Role permissions readable" ON public.role_permissions;
CREATE POLICY "Role permissions readable"
  ON public.role_permissions FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR public.is_member_of_tenant(auth.uid(), tenant_id));
DROP POLICY IF EXISTS "Role permissions writable by tenant admin" ON public.role_permissions;
CREATE POLICY "Role permissions writable by tenant admin"
  ON public.role_permissions FOR ALL TO authenticated
  USING (
    public.has_role_any_tenant(auth.uid(), 'super_admin'::public.app_role)
    OR (tenant_id IS NOT NULL AND public.is_member_of_tenant(auth.uid(), tenant_id) AND (public.has_role(auth.uid(), 'admin_tenant'::public.app_role, tenant_id) OR public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id)))
  )
  WITH CHECK (
    public.has_role_any_tenant(auth.uid(), 'super_admin'::public.app_role)
    OR (tenant_id IS NOT NULL AND public.is_member_of_tenant(auth.uid(), tenant_id) AND (public.has_role(auth.uid(), 'admin_tenant'::public.app_role, tenant_id) OR public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id)))
  );

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_sites_updated' AND tgrelid='public.sites'::regclass) THEN
    CREATE TRIGGER trg_sites_updated BEFORE UPDATE ON public.sites
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
  user_id UUID,
  external_ref TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  job_title TEXT,
  contract_type TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employees_tenant ON public.employees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employees_site ON public.employees(site_id);
CREATE INDEX IF NOT EXISTS idx_employees_user ON public.employees(user_id);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Employees readable by tenant or self" ON public.employees;
CREATE POLICY "Employees readable by tenant or self"
  ON public.employees FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id) OR user_id = auth.uid());
DROP POLICY IF EXISTS "Employees writable by tenant managers" ON public.employees;
CREATE POLICY "Employees writable by tenant managers"
  ON public.employees FOR ALL TO authenticated
  USING (
    public.is_member_of_tenant(auth.uid(), tenant_id)
    AND (
      public.has_role_any_tenant(auth.uid(), 'super_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'admin_tenant'::public.app_role, tenant_id)
      OR public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id)
      OR public.has_role(auth.uid(), 'manager'::public.app_role, tenant_id)
    )
  )
  WITH CHECK (
    public.is_member_of_tenant(auth.uid(), tenant_id)
    AND (
      public.has_role_any_tenant(auth.uid(), 'super_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'admin_tenant'::public.app_role, tenant_id)
      OR public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id)
      OR public.has_role(auth.uid(), 'manager'::public.app_role, tenant_id)
    )
  );
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_employees_updated' AND tgrelid='public.employees'::regclass) THEN
    CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role = 'super_admin'::public.app_role
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp
        ON rp.role = ur.role
       AND rp.permission_key = _permission_key
       AND rp.granted = true
       AND (rp.tenant_id IS NULL OR rp.tenant_id = ur.tenant_id)
      WHERE ur.user_id = _user_id
    );
$$;
REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated;

INSERT INTO public.permissions (key, label, module, description, is_technical) VALUES
  ('dossiers.view', 'Voir les dossiers', 'dossiers', 'Consulter les dossiers du tenant', false),
  ('dossiers.create', 'Créer un dossier', 'dossiers', NULL, false),
  ('dossiers.edit', 'Modifier un dossier', 'dossiers', NULL, false),
  ('dossiers.delete', 'Supprimer un dossier', 'dossiers', NULL, false),
  ('documents.upload', 'Déposer un document', 'documents', NULL, false),
  ('documents.analyze', 'Lancer une analyse IA', 'documents', NULL, false),
  ('documents.generate', 'Générer un document', 'documents', NULL, false),
  ('documents.validate', 'Valider un document généré', 'documents', NULL, false),
  ('workflows.run', 'Exécuter un workflow', 'workflows', NULL, false),
  ('workflows.validate', 'Valider une étape sensible', 'workflows', NULL, false),
  ('ia.ask', 'Interroger l''agent IA', 'ia', NULL, false),
  ('veille.view', 'Consulter la veille juridique', 'ia', NULL, false),
  ('clients.manage', 'Gérer les clients', 'admin', 'Cabinet : gérer ses clients', false),
  ('users.manage', 'Gérer les utilisateurs du tenant', 'admin', NULL, false),
  ('roles.manage', 'Attribuer les rôles', 'admin', NULL, false),
  ('sites.manage', 'Gérer les sites', 'admin', NULL, false),
  ('employees.manage', 'Gérer les salariés', 'admin', NULL, false),
  ('billing.manage', 'Gérer la facturation', 'admin', NULL, false),
  ('rag_quality.view', 'Voir la qualité RAG', 'technique', NULL, true),
  ('data_quality.view', 'Voir la qualité des données', 'technique', NULL, true),
  ('sources.manage', 'Gérer les sources juridiques', 'technique', NULL, true),
  ('connectors.manage', 'Gérer les connecteurs', 'technique', NULL, true),
  ('monitoring.view', 'Voir le monitoring système', 'technique', NULL, true),
  ('audit.view', 'Voir les logs d''audit', 'technique', NULL, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role, permission_key, granted)
SELECT NULL, 'super_admin'::public.app_role, key, true FROM public.permissions
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (tenant_id, role, permission_key, granted)
SELECT NULL, 'admin_tenant'::public.app_role, key, true FROM public.permissions WHERE is_technical = false
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (tenant_id, role, permission_key, granted)
SELECT NULL, 'admin'::public.app_role, key, true FROM public.permissions WHERE is_technical = false
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (tenant_id, role, permission_key, granted) VALUES
  (NULL, 'dirigeant'::public.app_role, 'dossiers.view', true),
  (NULL, 'dirigeant'::public.app_role, 'dossiers.create', true),
  (NULL, 'dirigeant'::public.app_role, 'dossiers.edit', true),
  (NULL, 'dirigeant'::public.app_role, 'documents.upload', true),
  (NULL, 'dirigeant'::public.app_role, 'documents.analyze', true),
  (NULL, 'dirigeant'::public.app_role, 'documents.generate', true),
  (NULL, 'dirigeant'::public.app_role, 'documents.validate', true),
  (NULL, 'dirigeant'::public.app_role, 'workflows.run', true),
  (NULL, 'dirigeant'::public.app_role, 'workflows.validate', true),
  (NULL, 'dirigeant'::public.app_role, 'ia.ask', true),
  (NULL, 'dirigeant'::public.app_role, 'veille.view', true),
  (NULL, 'dirigeant'::public.app_role, 'sites.manage', true),
  (NULL, 'dirigeant'::public.app_role, 'employees.manage', true),
  (NULL, 'daf'::public.app_role, 'dossiers.view', true),
  (NULL, 'daf'::public.app_role, 'dossiers.create', true),
  (NULL, 'daf'::public.app_role, 'dossiers.edit', true),
  (NULL, 'daf'::public.app_role, 'documents.upload', true),
  (NULL, 'daf'::public.app_role, 'documents.analyze', true),
  (NULL, 'daf'::public.app_role, 'documents.generate', true),
  (NULL, 'daf'::public.app_role, 'documents.validate', true),
  (NULL, 'daf'::public.app_role, 'workflows.run', true),
  (NULL, 'daf'::public.app_role, 'workflows.validate', true),
  (NULL, 'daf'::public.app_role, 'ia.ask', true),
  (NULL, 'daf'::public.app_role, 'veille.view', true),
  (NULL, 'daf'::public.app_role, 'billing.manage', true),
  (NULL, 'juriste'::public.app_role, 'dossiers.view', true),
  (NULL, 'juriste'::public.app_role, 'dossiers.create', true),
  (NULL, 'juriste'::public.app_role, 'dossiers.edit', true),
  (NULL, 'juriste'::public.app_role, 'documents.upload', true),
  (NULL, 'juriste'::public.app_role, 'documents.analyze', true),
  (NULL, 'juriste'::public.app_role, 'documents.generate', true),
  (NULL, 'juriste'::public.app_role, 'documents.validate', true),
  (NULL, 'juriste'::public.app_role, 'workflows.run', true),
  (NULL, 'juriste'::public.app_role, 'workflows.validate', true),
  (NULL, 'juriste'::public.app_role, 'ia.ask', true),
  (NULL, 'juriste'::public.app_role, 'veille.view', true),
  (NULL, 'avocat_partenaire'::public.app_role, 'dossiers.view', true),
  (NULL, 'avocat_partenaire'::public.app_role, 'documents.analyze', true),
  (NULL, 'avocat_partenaire'::public.app_role, 'documents.generate', true),
  (NULL, 'avocat_partenaire'::public.app_role, 'ia.ask', true),
  (NULL, 'avocat_partenaire'::public.app_role, 'veille.view', true),
  (NULL, 'comptable'::public.app_role, 'dossiers.view', true),
  (NULL, 'comptable'::public.app_role, 'dossiers.create', true),
  (NULL, 'comptable'::public.app_role, 'documents.upload', true),
  (NULL, 'comptable'::public.app_role, 'documents.analyze', true),
  (NULL, 'comptable'::public.app_role, 'documents.generate', true),
  (NULL, 'comptable'::public.app_role, 'ia.ask', true),
  (NULL, 'comptable'::public.app_role, 'veille.view', true),
  (NULL, 'manager'::public.app_role, 'dossiers.view', true),
  (NULL, 'manager'::public.app_role, 'dossiers.create', true),
  (NULL, 'manager'::public.app_role, 'dossiers.edit', true),
  (NULL, 'manager'::public.app_role, 'documents.upload', true),
  (NULL, 'manager'::public.app_role, 'documents.analyze', true),
  (NULL, 'manager'::public.app_role, 'documents.generate', true),
  (NULL, 'manager'::public.app_role, 'workflows.run', true),
  (NULL, 'manager'::public.app_role, 'workflows.validate', true),
  (NULL, 'manager'::public.app_role, 'ia.ask', true),
  (NULL, 'manager'::public.app_role, 'veille.view', true),
  (NULL, 'manager'::public.app_role, 'sites.manage', true),
  (NULL, 'manager'::public.app_role, 'employees.manage', true),
  (NULL, 'operationnel_terrain'::public.app_role, 'dossiers.view', true),
  (NULL, 'operationnel_terrain'::public.app_role, 'documents.upload', true),
  (NULL, 'operationnel_terrain'::public.app_role, 'documents.generate', true),
  (NULL, 'operationnel_terrain'::public.app_role, 'ia.ask', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'dossiers.view', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'dossiers.create', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'dossiers.edit', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'documents.upload', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'documents.analyze', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'documents.generate', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'documents.validate', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'workflows.run', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'ia.ask', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'veille.view', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'clients.manage', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'users.manage', true),
  (NULL, 'cabinet_comptable_admin'::public.app_role, 'billing.manage', true),
  (NULL, 'collaborateur_cabinet'::public.app_role, 'dossiers.view', true),
  (NULL, 'collaborateur_cabinet'::public.app_role, 'dossiers.create', true),
  (NULL, 'collaborateur_cabinet'::public.app_role, 'dossiers.edit', true),
  (NULL, 'collaborateur_cabinet'::public.app_role, 'documents.upload', true),
  (NULL, 'collaborateur_cabinet'::public.app_role, 'documents.analyze', true),
  (NULL, 'collaborateur_cabinet'::public.app_role, 'documents.generate', true),
  (NULL, 'collaborateur_cabinet'::public.app_role, 'workflows.run', true),
  (NULL, 'collaborateur_cabinet'::public.app_role, 'ia.ask', true),
  (NULL, 'collaborateur_cabinet'::public.app_role, 'veille.view', true),
  (NULL, 'collaborateur_cabinet'::public.app_role, 'clients.manage', true),
  (NULL, 'user'::public.app_role, 'dossiers.view', true),
  (NULL, 'user'::public.app_role, 'documents.upload', true),
  (NULL, 'user'::public.app_role, 'ia.ask', true)
ON CONFLICT DO NOTHING;
