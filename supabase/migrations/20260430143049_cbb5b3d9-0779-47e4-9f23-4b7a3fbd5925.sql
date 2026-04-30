-- 1. case_timeline_events
CREATE TABLE public.case_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dossier_id uuid NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  actor_id uuid,
  event_type text NOT NULL,
  title text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_timeline_dossier ON public.case_timeline_events(dossier_id, occurred_at DESC);
CREATE INDEX idx_timeline_tenant ON public.case_timeline_events(tenant_id, occurred_at DESC);
ALTER TABLE public.case_timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view tenant timeline" ON public.case_timeline_events FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert timeline" ON public.case_timeline_events FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Actor or admin updates timeline" ON public.case_timeline_events FOR UPDATE TO authenticated USING (actor_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id)) WITH CHECK (actor_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE POLICY "Actor or admin deletes timeline" ON public.case_timeline_events FOR DELETE TO authenticated USING (actor_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));

-- 2. identified_risks
CREATE TABLE public.identified_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dossier_id uuid NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  detected_by uuid NOT NULL,
  category text NOT NULL DEFAULT 'general',
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text,
  legal_basis jsonb NOT NULL DEFAULT '[]'::jsonb,
  mitigation text,
  status text NOT NULL DEFAULT 'open',
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identified_risks_severity_chk CHECK (severity IN ('low','medium','high','critical')),
  CONSTRAINT identified_risks_status_chk CHECK (status IN ('open','mitigated','accepted','closed'))
);
CREATE INDEX idx_risks_dossier ON public.identified_risks(dossier_id, severity);
CREATE INDEX idx_risks_tenant_status ON public.identified_risks(tenant_id, status);
ALTER TABLE public.identified_risks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view tenant risks" ON public.identified_risks FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert risks" ON public.identified_risks FOR INSERT TO authenticated WITH CHECK (detected_by = auth.uid() AND is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Detector or admin updates risks" ON public.identified_risks FOR UPDATE TO authenticated USING (detected_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id)) WITH CHECK (detected_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE POLICY "Detector or admin deletes risks" ON public.identified_risks FOR DELETE TO authenticated USING (detected_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE TRIGGER trg_risks_updated_at BEFORE UPDATE ON public.identified_risks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. validation_requests
CREATE TABLE public.validation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  assigned_to uuid NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  comment text,
  status text NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  decided_by uuid,
  decision_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT validation_requests_status_chk CHECK (status IN ('pending','approved','rejected','cancelled'))
);
CREATE INDEX idx_valreq_assignee ON public.validation_requests(assigned_to, status);
CREATE INDEX idx_valreq_dossier ON public.validation_requests(dossier_id);
CREATE INDEX idx_valreq_tenant ON public.validation_requests(tenant_id, status);
ALTER TABLE public.validation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view tenant validations" ON public.validation_requests FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert validations" ON public.validation_requests FOR INSERT TO authenticated WITH CHECK (requested_by = auth.uid() AND is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Requester assignee or admin update validations" ON public.validation_requests FOR UPDATE TO authenticated USING (requested_by = auth.uid() OR assigned_to = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id)) WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Requester or admin deletes validations" ON public.validation_requests FOR DELETE TO authenticated USING (requested_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE TRIGGER trg_valreq_updated_at BEFORE UPDATE ON public.validation_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. reminders
CREATE TABLE public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_by uuid NOT NULL,
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  remind_at timestamptz NOT NULL,
  sent_at timestamptz,
  dismissed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reminders_user_pending ON public.reminders(user_id, remind_at) WHERE dismissed_at IS NULL;
CREATE INDEX idx_reminders_tenant ON public.reminders(tenant_id, remind_at);
CREATE INDEX idx_reminders_due ON public.reminders(remind_at) WHERE sent_at IS NULL AND dismissed_at IS NULL;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view tenant reminders" ON public.reminders FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert reminders" ON public.reminders FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Target creator or admin updates reminders" ON public.reminders FOR UPDATE TO authenticated USING (user_id = auth.uid() OR created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id)) WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Creator or admin deletes reminders" ON public.reminders FOR DELETE TO authenticated USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE TRIGGER trg_reminders_updated_at BEFORE UPDATE ON public.reminders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();