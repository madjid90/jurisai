CREATE OR REPLACE FUNCTION public.get_next_batch_items(p_batch_id uuid, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total jsonb;
  v_processed jsonb;
  v_failed jsonb;
  v_chunk jsonb;
BEGIN
  SELECT total_items, processed_items, failed_items
  INTO v_total, v_processed, v_failed
  FROM public.ingestion_batch_state
  WHERE id = p_batch_id;

  IF v_total IS NULL OR jsonb_array_length(v_total) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH done_keys AS (
    SELECT COALESCE(
      item->>'id',
      item->>'article_id',
      item->>'kali_id',
      item->>'external_id',
      md5(item::text)
    ) AS item_key
    FROM jsonb_array_elements(COALESCE(v_processed, '[]'::jsonb)) item
    UNION
    SELECT COALESCE(
      item->>'id',
      item->>'article_id',
      item->>'kali_id',
      item->>'external_id',
      md5(item::text)
    ) AS item_key
    FROM jsonb_array_elements(COALESCE(v_failed, '[]'::jsonb)) item
  ),
  remaining AS (
    SELECT item, ord
    FROM jsonb_array_elements(v_total) WITH ORDINALITY AS t(item, ord)
    WHERE NOT EXISTS (
      SELECT 1
      FROM done_keys d
      WHERE d.item_key = COALESCE(
        item->>'id',
        item->>'article_id',
        item->>'kali_id',
        item->>'external_id',
        md5(item::text)
      )
    )
    ORDER BY ord
    LIMIT p_limit
  )
  SELECT jsonb_agg(item ORDER BY ord) INTO v_chunk FROM remaining;

  RETURN COALESCE(v_chunk, '[]'::jsonb);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_next_batch_items(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_next_batch_items(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_next_batch_items(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_batch_items(uuid, integer) TO service_role;