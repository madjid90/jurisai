CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Daily data quality check at 3am
SELECT cron.schedule(
  'daily-data-quality-checks',
  '0 3 * * *',
  $$ SELECT public.run_data_quality_checks(); $$
);

-- Hourly cleanup of stale rate limits
SELECT cron.schedule(
  'hourly-rate-limit-cleanup',
  '5 * * * *',
  $$ SELECT public.cleanup_rate_limits(); $$
);