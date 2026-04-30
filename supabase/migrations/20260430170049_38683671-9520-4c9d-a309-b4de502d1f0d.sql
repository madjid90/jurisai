REVOKE EXECUTE ON FUNCTION public.get_data_quality_snapshot() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_data_quality_snapshot() TO service_role;