-- Tenant API keys
CREATE TABLE public.tenant_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  created_by uuid NOT NULL,
  label text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{read}'::text[],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_api_keys_tenant ON public.tenant_api_keys(tenant_id);
CREATE UNIQUE INDEX idx_tenant_api_keys_prefix ON public.tenant_api_keys(prefix);
ALTER TABLE public.tenant_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage api keys" ON public.tenant_api_keys
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id));

-- Outbound webhooks
CREATE TABLE public.tenant_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  created_by uuid NOT NULL,
  target_url text NOT NULL,
  events text[] NOT NULL DEFAULT '{}'::text[],
  secret text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_webhooks_tenant ON public.tenant_webhooks(tenant_id, active);
ALTER TABLE public.tenant_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage webhooks" ON public.tenant_webhooks
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE TRIGGER trg_tenant_webhooks_updated BEFORE UPDATE ON public.tenant_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Webhook delivery log
CREATE TABLE public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL,
  response_code integer,
  error text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_deliveries_webhook ON public.webhook_deliveries(webhook_id, attempted_at DESC);
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view deliveries" ON public.webhook_deliveries
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));

-- Integrations (Slack channel, calendar token)
CREATE TABLE public.tenant_integrations (
  tenant_id uuid PRIMARY KEY,
  slack_channel text,
  slack_enabled boolean NOT NULL DEFAULT false,
  calendar_token uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_tenant_integrations_calendar_token ON public.tenant_integrations(calendar_token);
ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view integrations" ON public.tenant_integrations
  FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Admins update integrations" ON public.tenant_integrations
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role, tenant_id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE POLICY "Admins insert integrations" ON public.tenant_integrations
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE TRIGGER trg_tenant_integrations_updated BEFORE UPDATE ON public.tenant_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();