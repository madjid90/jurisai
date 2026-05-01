-- Restore EXECUTE permissions on SECURITY DEFINER helper functions used in RLS policies
GRANT EXECUTE ON FUNCTION public.is_member_of_tenant(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_role_any_tenant(uuid, public.app_role) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, anon, service_role;