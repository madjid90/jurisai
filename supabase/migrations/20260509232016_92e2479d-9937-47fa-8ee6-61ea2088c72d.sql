-- Activer les extensions nécessaires
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Supprimer un éventuel job précédent du même nom (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-reminders-every-10min');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Planifier le dispatch des rappels toutes les 10 minutes
SELECT cron.schedule(
  'dispatch-reminders-every-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app/api/public/hooks/dispatch-reminders',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1dnlzanN5dW14cGVrenZsenN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjQ2NzMsImV4cCI6MjA5MjgwMDY3M30.--88Kb73IMdi24MRQ0SYl1WSiihMIiei0O880fKGwcY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);