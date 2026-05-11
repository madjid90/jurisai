UPDATE public.ingestion_batch_state
SET status = 'paused', last_tick_at = now()
WHERE connector = 'judilibre-full'
  AND status = 'running'
  AND last_tick_at < now() - interval '3 minutes';