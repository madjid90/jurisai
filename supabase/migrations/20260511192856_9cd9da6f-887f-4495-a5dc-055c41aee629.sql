-- Reset zombie running batches (no progress > 5 min) so they can be resumed
UPDATE public.ingestion_batch_state
SET status = 'paused'
WHERE status = 'running'
  AND last_tick_at < now() - interval '5 minutes';

-- Heartbeat RPC: update last_tick_at without touching counters
CREATE OR REPLACE FUNCTION public.heartbeat_batch(p_batch_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ingestion_batch_state
  SET last_tick_at = now()
  WHERE id = p_batch_id;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.heartbeat_batch(uuid) TO service_role;