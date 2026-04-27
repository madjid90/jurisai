CREATE TABLE public.dossier_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dossier_comments_dossier ON public.dossier_comments(dossier_id, created_at DESC);
ALTER TABLE public.dossier_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant comments" ON public.dossier_comments
  FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members create comments" ON public.dossier_comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Author updates comments" ON public.dossier_comments
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Author or admin deletes comments" ON public.dossier_comments
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE TABLE public.dossier_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  created_by uuid NOT NULL,
  assigned_to uuid,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo',
  priority text NOT NULL DEFAULT 'normal',
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dossier_tasks_dossier ON public.dossier_tasks(dossier_id);
CREATE INDEX idx_dossier_tasks_assignee ON public.dossier_tasks(assigned_to, status);
ALTER TABLE public.dossier_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant tasks" ON public.dossier_tasks
  FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members create tasks" ON public.dossier_tasks
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Creator/assignee/admin update tasks" ON public.dossier_tasks
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR assigned_to = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id))
  WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Creator or admin deletes tasks" ON public.dossier_tasks
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, read_at, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER trg_dossier_comments_updated BEFORE UPDATE ON public.dossier_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_dossier_tasks_updated BEFORE UPDATE ON public.dossier_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.create_notification(
  _user_id uuid, _tenant_id uuid, _kind text, _title text,
  _body text DEFAULT NULL, _link text DEFAULT NULL, _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.notifications(user_id, tenant_id, kind, title, body, link, metadata)
  VALUES (_user_id, _tenant_id, _kind, _title, _body, _link, COALESCE(_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;