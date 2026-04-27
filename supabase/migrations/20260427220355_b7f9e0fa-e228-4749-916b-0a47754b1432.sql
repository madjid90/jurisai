-- Table: legal_alerts
CREATE TABLE public.legal_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.legal_sources(id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  change_type text NOT NULL DEFAULT 'new' CHECK (change_type IN ('new', 'updated', 'repealed')),
  idcc text,
  source_type text,
  official_url text,
  legal_date date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX legal_alerts_created_at_idx ON public.legal_alerts (created_at DESC);
CREATE INDEX legal_alerts_idcc_idx ON public.legal_alerts (idcc) WHERE idcc IS NOT NULL;

ALTER TABLE public.legal_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read alerts"
ON public.legal_alerts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Super admin manage alerts"
ON public.legal_alerts FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- Table: tenant_alert_subscriptions
CREATE TABLE public.tenant_alert_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('realtime', 'daily', 'weekly')),
  idcc_filters text[] NOT NULL DEFAULT '{}',
  severity_min text NOT NULL DEFAULT 'info' CHECK (severity_min IN ('info', 'warning', 'critical')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

ALTER TABLE public.tenant_alert_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant subscription"
ON public.tenant_alert_subscriptions FOR SELECT TO authenticated
USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Admins manage tenant subscription"
ON public.tenant_alert_subscriptions FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin', tenant_id))
WITH CHECK (public.has_role(auth.uid(), 'admin', tenant_id));

CREATE TRIGGER trg_tenant_alert_subs_updated
BEFORE UPDATE ON public.tenant_alert_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table: alert_dismissals (per-user "mark as read")
CREATE TABLE public.alert_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  alert_id uuid NOT NULL REFERENCES public.legal_alerts(id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, alert_id)
);

CREATE INDEX alert_dismissals_user_idx ON public.alert_dismissals (user_id);

ALTER TABLE public.alert_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own dismissals"
ON public.alert_dismissals FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());