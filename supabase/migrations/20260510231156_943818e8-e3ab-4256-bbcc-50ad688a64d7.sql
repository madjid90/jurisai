
-- =========================================================
-- LOT 10 — Partitionnement de public.messages par mois
-- + FK composites depuis chat_citations et message_feedback
-- =========================================================

BEGIN;

-- 1) Sauvegarde de l'ancienne table
ALTER TABLE public.messages RENAME TO messages_old;
ALTER INDEX public.messages_pkey RENAME TO messages_old_pkey;
ALTER INDEX public.idx_messages_conversation RENAME TO idx_messages_old_conversation;

-- 2) Nouvelle table partitionnée
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role = ANY (ARRAY['user','assistant','system'])),
  content text NOT NULL,
  tokens_used integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Index global (propagé aux partitions)
CREATE INDEX idx_messages_conversation
  ON public.messages (conversation_id, created_at);

-- 3) Partitions mensuelles 2026 + défaut
CREATE TABLE public.messages_2026_01 PARTITION OF public.messages
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE public.messages_2026_02 PARTITION OF public.messages
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE public.messages_2026_03 PARTITION OF public.messages
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE public.messages_2026_04 PARTITION OF public.messages
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE public.messages_2026_05 PARTITION OF public.messages
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE public.messages_2026_06 PARTITION OF public.messages
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE public.messages_2026_07 PARTITION OF public.messages
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE public.messages_2026_08 PARTITION OF public.messages
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE public.messages_2026_09 PARTITION OF public.messages
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE public.messages_2026_10 PARTITION OF public.messages
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE public.messages_2026_11 PARTITION OF public.messages
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE public.messages_2026_12 PARTITION OF public.messages
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE public.messages_default PARTITION OF public.messages DEFAULT;

-- 4) Copie des données
INSERT INTO public.messages (id, conversation_id, role, content, tokens_used, created_at)
SELECT id, conversation_id, role, content, tokens_used, created_at
FROM public.messages_old;

-- 5) RLS + policies (recréées à l'identique)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant messages"
ON public.messages FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.conversations c
  WHERE c.id = messages.conversation_id
    AND public.is_member_of_tenant(auth.uid(), c.tenant_id)
));

CREATE POLICY "Conversation owner inserts messages"
ON public.messages FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.conversations c
  WHERE c.id = messages.conversation_id
    AND c.user_id = auth.uid()
));

CREATE POLICY "Users can delete their own messages"
ON public.messages FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.conversations c
  WHERE c.id = messages.conversation_id
    AND c.user_id = auth.uid()
));

-- 6) Ajout colonne message_created_at sur tables enfants + backfill
ALTER TABLE public.chat_citations
  ADD COLUMN message_created_at timestamptz;
UPDATE public.chat_citations cc
   SET message_created_at = m.created_at
  FROM public.messages_old m
 WHERE m.id = cc.message_id;
ALTER TABLE public.chat_citations
  ALTER COLUMN message_created_at SET NOT NULL;

ALTER TABLE public.message_feedback
  ADD COLUMN message_created_at timestamptz;
UPDATE public.message_feedback mf
   SET message_created_at = m.created_at
  FROM public.messages_old m
 WHERE m.id = mf.message_id;
ALTER TABLE public.message_feedback
  ALTER COLUMN message_created_at SET NOT NULL;

-- 7) Suppression des anciennes FKs vers messages_old + suppression de la table
ALTER TABLE public.chat_citations
  DROP CONSTRAINT chat_citations_message_id_fkey;
ALTER TABLE public.message_feedback
  DROP CONSTRAINT message_feedback_message_fk;

DROP TABLE public.messages_old;

-- 8) FK composites vers la nouvelle table partitionnée
ALTER TABLE public.chat_citations
  ADD CONSTRAINT chat_citations_message_fkey
  FOREIGN KEY (message_id, message_created_at)
  REFERENCES public.messages(id, created_at)
  ON DELETE CASCADE;

ALTER TABLE public.message_feedback
  ADD CONSTRAINT message_feedback_message_fkey
  FOREIGN KEY (message_id, message_created_at)
  REFERENCES public.messages(id, created_at)
  ON DELETE CASCADE;

-- 9) Index pour accélérer les jointures via la colonne ajoutée
CREATE INDEX IF NOT EXISTS idx_chat_citations_message
  ON public.chat_citations (message_id, message_created_at);
CREATE INDEX IF NOT EXISTS idx_message_feedback_message
  ON public.message_feedback (message_id, message_created_at);

-- 10) Fonction utilitaire : créer la partition d'un mois à la volée
CREATE OR REPLACE FUNCTION public.ensure_messages_partition(p_month date DEFAULT (date_trunc('month', now()))::date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (v_start + interval '1 month')::date;
  v_name  text := 'messages_' || to_char(v_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.messages FOR VALUES FROM (%L) TO (%L)',
    v_name, v_start, v_end
  );
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_name);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_messages_partition(date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ensure_messages_partition(date) TO service_role;

COMMIT;
