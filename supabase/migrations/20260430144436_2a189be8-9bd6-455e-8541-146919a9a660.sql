-- Révoquer EXECUTE à PUBLIC (inclut anon + authenticated par défaut)
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_member_of_tenant(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_api_key(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_questions_used(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_data_quality_checks() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_ingestion_job(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hybrid_search(vector, text, integer, text, integer) FROM PUBLIC;

-- Réaccorder explicitement à service_role (admin client côté serveur)
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_member_of_tenant(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_api_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits() TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_questions_used(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_data_quality_checks() TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_ingestion_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hybrid_search(vector, text, integer, text, integer) TO service_role;
-- handle_new_user est un trigger (auth.users) — pas besoin d'être grant à service_role
-- set_updated_at est un trigger — idem