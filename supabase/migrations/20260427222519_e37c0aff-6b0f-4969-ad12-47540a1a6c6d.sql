
-- Audit logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  api_key_id uuid REFERENCES public.tenant_api_keys(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx
  ON public.audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx
  ON public.audit_logs (tenant_id, action, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read tenant audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id));

-- No INSERT/UPDATE/DELETE policies → only service_role can write.

-- ─── Validate API key (used by REST routes) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_api_key(_key_hash text)
RETURNS TABLE(api_key_id uuid, tenant_id uuid, scopes text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.tenant_api_keys
     SET last_used_at = now()
   WHERE key_hash = _key_hash
     AND revoked_at IS NULL
  RETURNING id, tenant_id, scopes;
$$;
