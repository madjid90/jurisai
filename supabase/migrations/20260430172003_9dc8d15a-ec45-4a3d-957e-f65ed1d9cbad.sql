CREATE TABLE IF NOT EXISTS public.digest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly')),
  user_id uuid,
  tenant_id uuid,
  items_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','skipped','failed')),
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.digest_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "digest_runs super_admin read" ON public.digest_runs;
CREATE POLICY "digest_runs super_admin read"
  ON public.digest_runs FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS digest_runs_user_idx ON public.digest_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS digest_runs_freq_idx ON public.digest_runs (frequency, created_at DESC);
