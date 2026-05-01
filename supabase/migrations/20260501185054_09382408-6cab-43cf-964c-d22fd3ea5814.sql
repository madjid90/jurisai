-- Veille active : fan-out automatique des nouvelles alertes juridiques
-- vers les notifications utilisateurs des tenants abonnés (selon filtres severity_min + idcc)

CREATE OR REPLACE FUNCTION public.fanout_legal_alert_to_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sev_rank int;
  rec record;
  user_rec record;
BEGIN
  sev_rank := CASE NEW.severity
    WHEN 'critical' THEN 2
    WHEN 'warning' THEN 1
    ELSE 0
  END;

  FOR rec IN
    SELECT s.tenant_id, s.idcc_filters, s.severity_min
    FROM public.tenant_alert_subscriptions s
    WHERE
      CASE s.severity_min
        WHEN 'critical' THEN 2
        WHEN 'warning'  THEN 1
        ELSE 0
      END <= sev_rank
      AND (
        s.idcc_filters IS NULL
        OR array_length(s.idcc_filters, 1) IS NULL
        OR NEW.idcc IS NULL
        OR NEW.idcc = ANY(s.idcc_filters)
      )
  LOOP
    FOR user_rec IN
      SELECT id AS user_id
      FROM public.profiles
      WHERE tenant_id = rec.tenant_id
    LOOP
      INSERT INTO public.notifications (user_id, tenant_id, kind, title, body, link, metadata)
      VALUES (
        user_rec.user_id,
        rec.tenant_id,
        'legal_alert',
        NEW.title,
        COALESCE(NEW.summary, ''),
        '/veille',
        jsonb_build_object(
          'alert_id', NEW.id,
          'severity', NEW.severity,
          'change_type', NEW.change_type,
          'idcc', NEW.idcc,
          'official_url', NEW.official_url
        )
      );
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fanout_legal_alert_to_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fanout_legal_alert_to_notifications() TO service_role;

DROP TRIGGER IF EXISTS trg_fanout_legal_alert ON public.legal_alerts;
CREATE TRIGGER trg_fanout_legal_alert
AFTER INSERT ON public.legal_alerts
FOR EACH ROW
EXECUTE FUNCTION public.fanout_legal_alert_to_notifications();