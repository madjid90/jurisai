-- ===== 1) rgpd_requests =====
CREATE TABLE IF NOT EXISTS public.rgpd_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid,
  kind text NOT NULL CHECK (kind IN ('export','delete')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.rgpd_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own rgpd requests"
  ON public.rgpd_requests FOR SELECT
  USING (auth.uid() = user_id OR public.is_super_admin(auth.uid()));

CREATE POLICY "Users insert their own rgpd requests"
  ON public.rgpd_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_rgpd_requests_user ON public.rgpd_requests(user_id, requested_at DESC);
CREATE INDEX idx_rgpd_requests_status ON public.rgpd_requests(status, requested_at DESC);

-- ===== 2) Index manquants =====
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created
  ON public.notifications(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON public.notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_dossier_comments_tenant_created
  ON public.dossier_comments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dossier_comments_user
  ON public.dossier_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON public.conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created
  ON public.agent_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_created
  ON public.agent_tool_runs(created_at DESC);