DO $$
DECLARE
  v_secret text := 'd41073d38c6846551c24c4a8f4a3b242fc648c9860a039317541d87c05b91df9';
  v_base text := 'https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app/api/public/hooks';
  v_existing uuid;
BEGIN
  -- Upsert dans Vault
  SELECT id INTO v_existing FROM vault.secrets WHERE name = 'CRON_SECRET';
  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(v_secret, 'CRON_SECRET', 'Shared HMAC for pg_cron → /api/public/hooks');
  ELSE
    PERFORM vault.update_secret(v_existing, v_secret);
  END IF;

  -- Unschedule existing HTTP jobs (idempotent)
  PERFORM cron.unschedule(jobname) FROM cron.job
   WHERE jobname IN (
     'jurisai-digest-daily','jurisai-digest-weekly',
     'jurisai-orchestrator-tick','dispatch-reminders-every-10min',
     'contract-deadlines-daily'
   );

  -- Reschedule with x-cron-secret header
  PERFORM cron.schedule('jurisai-digest-daily', '0 7 * * *', format($cmd$
    SELECT net.http_post(
      url := '%s/digest',
      headers := %L::jsonb,
      body := '{"frequency":"daily"}'::jsonb
    );
  $cmd$, v_base, json_build_object('Content-Type','application/json','x-cron-secret',v_secret)::text));

  PERFORM cron.schedule('jurisai-digest-weekly', '0 7 * * 1', format($cmd$
    SELECT net.http_post(
      url := '%s/digest',
      headers := %L::jsonb,
      body := '{"frequency":"weekly"}'::jsonb
    );
  $cmd$, v_base, json_build_object('Content-Type','application/json','x-cron-secret',v_secret)::text));

  PERFORM cron.schedule('jurisai-orchestrator-tick', '*/10 * * * *', format($cmd$
    SELECT net.http_post(
      url := '%s/orchestrator-tick',
      headers := %L::jsonb,
      body := '{}'::jsonb
    );
  $cmd$, v_base, json_build_object('Content-Type','application/json','x-cron-secret',v_secret)::text));

  PERFORM cron.schedule('dispatch-reminders-every-10min', '*/10 * * * *', format($cmd$
    SELECT net.http_post(
      url := '%s/dispatch-reminders',
      headers := %L::jsonb,
      body := '{}'::jsonb
    );
  $cmd$, v_base, json_build_object('Content-Type','application/json','x-cron-secret',v_secret)::text));

  PERFORM cron.schedule('contract-deadlines-daily', '0 6 * * *', format($cmd$
    SELECT net.http_post(
      url := '%s/contract-deadlines',
      headers := %L::jsonb,
      body := '{}'::jsonb
    );
  $cmd$, v_base, json_build_object('Content-Type','application/json','x-cron-secret',v_secret)::text));
END $$;