-- Lot 7 : Notifications temps réel
-- 1) Attacher le trigger de fan-out des alertes légales sur legal_alerts
DROP TRIGGER IF EXISTS trg_fanout_legal_alert ON public.legal_alerts;
CREATE TRIGGER trg_fanout_legal_alert
AFTER INSERT ON public.legal_alerts
FOR EACH ROW
EXECUTE FUNCTION public.fanout_legal_alert_to_notifications();

-- 2) Notifier les utilisateurs du tenant lors d'une suggestion de liaison document↔dossier
CREATE OR REPLACE FUNCTION public.notify_document_link_suggestion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_rec record;
  doc_name text;
  dossier_title text;
BEGIN
  -- Ne notifier que pour les nouvelles suggestions pending
  IF NEW.status <> 'pending' OR NEW.link_method <> 'suggested' THEN
    RETURN NEW;
  END IF;

  SELECT filename INTO doc_name FROM public.document_analyses WHERE id = NEW.document_id;
  SELECT title INTO dossier_title FROM public.dossiers WHERE id = NEW.dossier_id;

  FOR user_rec IN
    SELECT id AS user_id FROM public.profiles WHERE tenant_id = NEW.tenant_id
  LOOP
    INSERT INTO public.notifications (user_id, tenant_id, kind, title, body, link, metadata)
    VALUES (
      user_rec.user_id,
      NEW.tenant_id,
      'document_link_suggested',
      'Nouvelle suggestion de rattachement',
      COALESCE(doc_name, 'Document') || ' → ' || COALESCE(dossier_title, 'dossier'),
      '/links',
      jsonb_build_object(
        'link_id', NEW.id,
        'document_id', NEW.document_id,
        'dossier_id', NEW.dossier_id,
        'confidence', NEW.confidence
      )
    );
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_document_link_suggestion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_document_link_suggestion() TO service_role;

DROP TRIGGER IF EXISTS trg_notify_document_link ON public.document_links;
CREATE TRIGGER trg_notify_document_link
AFTER INSERT ON public.document_links
FOR EACH ROW
EXECUTE FUNCTION public.notify_document_link_suggestion();

-- 3) Activer Realtime sur notifications pour push live (idempotent)
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;