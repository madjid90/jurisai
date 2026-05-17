-- Schedule pg_cron pour la veille juridique active.
-- Appelle /api/public/hooks/legal-watch qui déclenche l'edge function legal-watch-cron.
-- Cette dernière scan les legal_sources des dernières 24h, crée des legal_alerts
-- (qui sont ensuite fanout-és vers notifications via le trigger existant
--  fanout_legal_alert_to_notifications — migration 20260501185054).
--
-- Idempotent : unschedule avant reschedule.

DO $$
DECLARE
  v_secret text;
  v_base text := 'https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app/api/public/hooks';
BEGIN
  -- Lecture du CRON_SECRET déjà seedé pour les autres crons
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE NOTICE 'CRON_SECRET non trouvé dans le Vault — cron legal-watch désactivé.';
    RETURN;
  END IF;

  -- Unschedule si déjà présent (idempotent)
  PERFORM cron.unschedule(jobname) FROM cron.job
   WHERE jobname = 'jurisai-legal-watch-daily';

  -- Schedule quotidien à 6h05 UTC (~ 7h05 Paris hiver, 8h05 été)
  PERFORM cron.schedule(
    'jurisai-legal-watch-daily',
    '5 6 * * *',
    format($cmd$
      SELECT net.http_post(
        url := '%s/legal-watch',
        headers := %L::jsonb,
        body := '{}'::jsonb
      );
    $cmd$,
    v_base,
    json_build_object('Content-Type','application/json','x-cron-secret',v_secret)::text)
  );

  RAISE NOTICE 'jurisai-legal-watch-daily scheduled (06:05 UTC daily).';
END $$;
