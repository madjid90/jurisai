CREATE OR REPLACE FUNCTION public.finalize_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_state record;
  v_final_status text;
  v_retry_pass int;
  v_max_retry  int := 2;
BEGIN
  SELECT * INTO v_state
  FROM public.ingestion_batch_state
  WHERE id = p_batch_id;

  -- Batch supprimé ou inexistant : retourner completed pour casser toute boucle d'auto-resume
  IF v_state.id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'completed', 'processed', 0, 'failed', 0,
      'total', 0, 'articles_ingested', 0
    );
  END IF;

  -- Batch sans aucun item planifié : completed direct (évite boucle infinie quand planning vide)
  IF COALESCE(v_state.total_count, 0) = 0 THEN
    UPDATE public.ingestion_batch_state
    SET status = 'completed', completed_at = now(), last_tick_at = now()
    WHERE id = p_batch_id;
    RETURN jsonb_build_object(
      'status', 'completed', 'processed', 0, 'failed', 0,
      'total', 0, 'articles_ingested', COALESCE(v_state.articles_ingested, 0)
    );
  END IF;

  v_retry_pass := COALESCE((v_state.metadata->>'retry_pass')::int, 0);

  IF v_state.processed_count + v_state.failed_count >= v_state.total_count THEN
    IF v_state.failed_count > 0 AND v_retry_pass < v_max_retry THEN
      UPDATE public.ingestion_batch_state
      SET
        total_items   = COALESCE(total_items, '[]'::jsonb) || COALESCE(failed_items, '[]'::jsonb),
        total_count   = COALESCE(total_count, 0) + COALESCE(failed_count, 0),
        failed_items  = '[]'::jsonb,
        failed_count  = 0,
        status        = 'paused',
        last_tick_at  = now(),
        metadata      = COALESCE(metadata, '{}'::jsonb)
                        || jsonb_build_object('retry_pass', v_retry_pass + 1)
      WHERE id = p_batch_id;

      RETURN jsonb_build_object(
        'status', 'paused',
        'processed', v_state.processed_count,
        'failed', 0,
        'total', v_state.total_count + v_state.failed_count,
        'articles_ingested', v_state.articles_ingested,
        'retry_pass', v_retry_pass + 1
      );
    END IF;

    v_final_status := CASE
      WHEN v_state.failed_count >= v_state.total_count THEN 'failed'
      WHEN v_state.processed_count > 0 THEN 'completed'
      ELSE 'failed'
    END;

    UPDATE public.ingestion_batch_state
    SET status = v_final_status, completed_at = now(), last_tick_at = now()
    WHERE id = p_batch_id;
  ELSE
    UPDATE public.ingestion_batch_state
    SET status = 'paused', last_tick_at = now()
    WHERE id = p_batch_id;
    v_final_status := 'paused';
  END IF;

  RETURN jsonb_build_object(
    'status', v_final_status,
    'processed', v_state.processed_count,
    'failed', v_state.failed_count,
    'total', v_state.total_count,
    'articles_ingested', v_state.articles_ingested
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.finalize_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_batch(uuid) TO service_role;