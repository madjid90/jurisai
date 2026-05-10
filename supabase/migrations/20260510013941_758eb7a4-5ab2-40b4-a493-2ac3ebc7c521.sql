CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: remove existing schedule before re-creating
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jurisai-orchestrator-tick') THEN
    PERFORM cron.unschedule('jurisai-orchestrator-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'jurisai-orchestrator-tick',
  '*/10 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app/api/public/hooks/orchestrator-tick',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1dnlzanN5dW14cGVrenZsenN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjQ2NzMsImV4cCI6MjA5MjgwMDY3M30.--88Kb73IMdi24MRQ0SYl1WSiihMIiei0O880fKGwcY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);