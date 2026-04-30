
-- Table agent_runs : trace chaque exécution de l'agent (input, intent détectée, sortie structurée).
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  dossier_id UUID REFERENCES public.dossiers(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  intent TEXT,
  domain TEXT,
  topic TEXT,
  confidence NUMERIC,
  requires_rag BOOLEAN DEFAULT false,
  requires_document_upload BOOLEAN DEFAULT false,
  requires_form BOOLEAN DEFAULT false,
  requires_validation BOOLEAN DEFAULT false,
  suggested_actions JSONB DEFAULT '[]'::jsonb,
  missing_information JSONB DEFAULT '[]'::jsonb,
  answer TEXT,
  sources JSONB DEFAULT '[]'::jsonb,
  refused BOOLEAN DEFAULT false,
  refusal_reason TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant ON public.agent_runs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_dossier ON public.agent_runs(dossier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON public.agent_runs(user_id, created_at DESC);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_runs_select_tenant_member"
  ON public.agent_runs FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

-- Pas de policy INSERT/UPDATE : écriture exclusive via service_role (server functions).

-- Table agent_tool_runs : trace chaque appel d'outil par l'agent.
CREATE TABLE IF NOT EXISTS public.agent_tool_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_run_id UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  args JSONB DEFAULT '{}'::jsonb,
  result JSONB DEFAULT '{}'::jsonb,
  is_sensitive BOOLEAN DEFAULT false,
  validation_request_id UUID REFERENCES public.validation_requests(id) ON DELETE SET NULL,
  succeeded BOOLEAN DEFAULT true,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_run ON public.agent_tool_runs(agent_run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_tenant ON public.agent_tool_runs(tenant_id, created_at DESC);

ALTER TABLE public.agent_tool_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_tool_runs_select_tenant_member"
  ON public.agent_tool_runs FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));
