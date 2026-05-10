-- Realtime sur agent_runs
ALTER TABLE public.agent_runs REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_runs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs';
  END IF;
END$$;

-- secret_last4 pour affichage non sensible
ALTER TABLE public.tenant_webhooks
  ADD COLUMN IF NOT EXISTS secret_last4 text;

UPDATE public.tenant_webhooks
   SET secret_last4 = right(secret, 4)
 WHERE secret_last4 IS NULL;