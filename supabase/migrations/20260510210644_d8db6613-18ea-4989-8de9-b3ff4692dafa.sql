DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE 'usage_logs_part_%'
      AND c.relname NOT LIKE '%_pkey'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.rel);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_usage_logs_partition(p_month date DEFAULT date_trunc('month', now())::date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (v_start + interval '1 month')::date;
  v_name  text := 'usage_logs_part_' || to_char(v_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.usage_logs FOR VALUES FROM (%L) TO (%L)',
    v_name, v_start, v_end
  );
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_name);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_usage_logs_partition(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_usage_logs_partition(date) TO service_role;
