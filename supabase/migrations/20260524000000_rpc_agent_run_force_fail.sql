-- RPC SECURITY DEFINER pour faire avancer un agent_run depuis le watchdog
-- (cron) même quand SUPABASE_SERVICE_ROLE_KEY est en réalité une anon key
-- sur Lovable. Avant ce fix : db.from('agent_runs').update() était bloqué
-- silencieusement par RLS → 9 runs stuck depuis 158h.
--
-- Cf AUDIT-JURISAI-V6.md §3 P1.
-- Appliqué en prod le 2026-05-24 via Supabase MCP.

CREATE OR REPLACE FUNCTION public.agent_run_force_fail(
  _run_id uuid,
  _expected_statuses text[],
  _new_status text,
  _error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current text;
  v_updated int;
BEGIN
  IF _new_status NOT IN ('failed','archived') THEN
    RAISE EXCEPTION 'invalid target status: %', _new_status;
  END IF;

  SELECT status INTO v_current FROM public.agent_runs WHERE id = _run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  IF NOT (v_current = ANY(_expected_statuses)) THEN
    RETURN jsonb_build_object(
      'updated', false,
      'reason', 'status_mismatch',
      'current', v_current
    );
  END IF;

  UPDATE public.agent_runs
  SET status = _new_status,
      error_message = COALESCE(_error_message, error_message),
      updated_at = now(),
      archived_at = CASE WHEN _new_status = 'archived' THEN now() ELSE archived_at END
  WHERE id = _run_id
    AND status = ANY(_expected_statuses);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'updated', v_updated > 0,
    'rows_affected', v_updated,
    'previous_status', v_current,
    'new_status', _new_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agent_run_force_fail(uuid, text[], text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.agent_run_force_fail IS
  'Force la transition d''un agent_run vers failed ou archived (utilisé par le watchdog).
   SECURITY DEFINER pour bypass RLS quand supabaseAdmin n''a pas le vrai service_role.
   Retourne {updated, rows_affected, previous_status, new_status, reason?}.';
