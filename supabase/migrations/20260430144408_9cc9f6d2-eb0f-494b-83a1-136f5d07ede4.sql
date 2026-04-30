-- Révocation EXECUTE sur fonctions SECURITY DEFINER internes
-- Elles restent appelables par postgres (RLS policies) et service_role (admin client serveur)

REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_member_of_tenant(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.validate_api_key(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, uuid, text, text, text, text, jsonb) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_questions_used(uuid) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.run_data_quality_checks() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_ingestion_job(uuid) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated;

-- hybrid_search est appelée depuis les server functions (service_role) — sécuriser de la même façon
REVOKE EXECUTE ON FUNCTION public.hybrid_search(vector, text, integer, text, integer) FROM anon, authenticated;