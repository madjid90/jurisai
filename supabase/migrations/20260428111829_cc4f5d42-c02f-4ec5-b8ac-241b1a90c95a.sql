-- 1. rate_limits : RLS activé mais aucune policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='rate_limits' AND policyname='Users can read own rate limits'
  ) THEN
    CREATE POLICY "Users can read own rate limits"
      ON public.rate_limits FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- 2. Restreindre les fonctions SECURITY DEFINER sensibles à service_role
REVOKE ALL ON FUNCTION public.promote_ingestion_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_data_quality_checks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_api_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_notification(uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.promote_ingestion_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_data_quality_checks() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_api_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid,uuid,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits() TO service_role;

-- 3. Garder explicitement EXECUTE pour les helpers utilisés dans les RLS
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_member_of_tenant(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_questions_used(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer) TO authenticated;