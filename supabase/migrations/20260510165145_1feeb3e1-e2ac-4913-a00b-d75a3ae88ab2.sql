CREATE OR REPLACE FUNCTION public.purge_expired_workflow_audit()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted int;
BEGIN
  DELETE FROM public.workflow_audit_log
  WHERE retention_until < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_workflow_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_workflow_audit() TO service_role;

CREATE OR REPLACE VIEW public.v_workflow_audit_stats
WITH (security_invoker = on) AS
SELECT
  tenant_id,
  date_trunc('month', created_at)::date AS month,
  action,
  count(*) AS event_count,
  count(DISTINCT user_id) AS distinct_users
FROM public.workflow_audit_log
WHERE created_at >= now() - interval '24 months'
GROUP BY tenant_id, date_trunc('month', created_at), action;