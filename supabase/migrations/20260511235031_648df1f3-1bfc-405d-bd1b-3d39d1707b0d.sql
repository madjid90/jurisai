
UPDATE public.ingestion_batch_state
SET
  total_items  = COALESCE(total_items, '[]'::jsonb) || COALESCE(failed_items, '[]'::jsonb),
  total_count  = COALESCE(total_count, 0) + COALESCE(failed_count, 0),
  failed_items = '[]'::jsonb,
  failed_count = 0,
  status       = 'paused',
  completed_at = NULL,
  last_tick_at = now(),
  metadata     = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object('retry_pass', COALESCE((metadata->>'retry_pass')::int, 0) + 1)
WHERE failed_count > 0
  AND status IN ('completed','failed','paused')
  AND COALESCE((metadata->>'retry_pass')::int, 0) < 2;
