ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS final_document_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_status_check') THEN
    ALTER TABLE public.agent_runs
      ADD CONSTRAINT agent_runs_status_check
      CHECK (status IN ('pending','running','waiting_info','waiting_validation','ready','executed','archived','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_status ON public.agent_runs(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_status ON public.agent_runs(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_dossier ON public.agent_runs(dossier_id) WHERE dossier_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_agent_runs_updated_at ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_updated_at
  BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS agent_runs_insert_self ON public.agent_runs;
CREATE POLICY agent_runs_insert_self
  ON public.agent_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_member_of_tenant(auth.uid(), tenant_id)
  );

DROP POLICY IF EXISTS agent_runs_update_owner_or_admin ON public.agent_runs;
CREATE POLICY agent_runs_update_owner_or_admin
  ON public.agent_runs
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role, tenant_id)
  )
  WITH CHECK (
    public.is_member_of_tenant(auth.uid(), tenant_id)
  );