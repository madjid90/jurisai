CREATE OR REPLACE FUNCTION public.append_batch_items(
  p_batch_id uuid,
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN;
  END IF;
  UPDATE public.ingestion_batch_state
  SET total_items = COALESCE(total_items, '[]'::jsonb) || p_items,
      total_count = COALESCE(total_count, 0) + jsonb_array_length(p_items),
      last_tick_at = now()
  WHERE id = p_batch_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.append_batch_items(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.append_batch_items(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_batch_items(uuid, jsonb) TO service_role;