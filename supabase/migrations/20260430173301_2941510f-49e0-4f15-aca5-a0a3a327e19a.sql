-- Cron jobs pour le digest JurisAI
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Nettoyer d'éventuels anciens jobs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jurisai-digest-daily') THEN
    PERFORM cron.unschedule('jurisai-digest-daily');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jurisai-digest-weekly') THEN
    PERFORM cron.unschedule('jurisai-digest-weekly');
  END IF;
END $$;

-- Daily : tous les jours à 7h00 UTC
SELECT cron.schedule(
  'jurisai-digest-daily',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app/api/public/hooks/digest',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1dnlzanN5dW14cGVrenZsenN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjQ2NzMsImV4cCI6MjA5MjgwMDY3M30.--88Kb73IMdi24MRQ0SYl1WSiihMIiei0O880fKGwcY"}'::jsonb,
    body := '{"frequency":"daily"}'::jsonb
  );
  $$
);

-- Weekly : lundi à 7h00 UTC
SELECT cron.schedule(
  'jurisai-digest-weekly',
  '0 7 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app/api/public/hooks/digest',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1dnlzanN5dW14cGVrenZsenN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjQ2NzMsImV4cCI6MjA5MjgwMDY3M30.--88Kb73IMdi24MRQ0SYl1WSiihMIiei0O880fKGwcY"}'::jsonb,
    body := '{"frequency":"weekly"}'::jsonb
  );
  $$
);