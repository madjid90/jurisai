-- Table conversations
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nouvelle question',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_tenant ON public.conversations(tenant_id, created_at DESC);
CREATE INDEX idx_conversations_user ON public.conversations(user_id, created_at DESC);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant conversations"
  ON public.conversations FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Members create conversations in their tenant"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_member_of_tenant(auth.uid(), tenant_id)
  );

CREATE POLICY "Users update own conversations"
  ON public.conversations FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own conversations"
  ON public.conversations FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table messages
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at ASC);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant messages"
  ON public.messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND public.is_member_of_tenant(auth.uid(), c.tenant_id)
    )
  );

CREATE POLICY "Conversation owner inserts messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- Fonction atomique d'incrément du quota (retourne true si ok, false si dépassé)
CREATE OR REPLACE FUNCTION public.increment_questions_used(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quota INTEGER;
  v_used INTEGER;
BEGIN
  SELECT quota_questions, questions_used INTO v_quota, v_used
  FROM public.tenants WHERE id = _tenant_id FOR UPDATE;

  IF v_used >= v_quota THEN
    RETURN FALSE;
  END IF;

  UPDATE public.tenants
  SET questions_used = questions_used + 1,
      updated_at = now()
  WHERE id = _tenant_id;

  RETURN TRUE;
END;
$$;