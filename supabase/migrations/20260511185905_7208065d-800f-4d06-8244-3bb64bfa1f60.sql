UPDATE public.ingestion_batch_state
   SET status = 'paused', last_tick_at = now()
 WHERE status = 'running'
   AND (last_tick_at IS NULL OR last_tick_at < now() - interval '5 minutes');