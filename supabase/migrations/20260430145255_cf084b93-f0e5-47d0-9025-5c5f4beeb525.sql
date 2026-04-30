-- ──────────────────────────────────────────────────────────────────────────
-- 1. sites — réseaux multi-sites
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  code text,
  address text,
  city text,
  postal_code text,
  manager_user_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sites_tenant ON public.sites(tenant_id, is_active);
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view sites" ON public.sites FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert sites" ON public.sites FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Admins update sites" ON public.sites FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE POLICY "Admins delete sites" ON public.sites FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE TRIGGER trg_sites_updated BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. legal_updates — veille juridique actionnable
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE public.legal_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.legal_sources(id) ON DELETE SET NULL,
  domain text NOT NULL, -- droit_social_rh | droit_commercial | droit_societes | rgpd_conformite | fiscalite_simple | reglementation_metier | jurisprudence | convention_collective
  title text NOT NULL,
  summary text NOT NULL,
  full_text text,
  publication_date date,
  effective_date date,
  who_is_concerned text, -- "Toutes entreprises", "PME secteur HCR", "Employeurs >50 salariés"...
  practical_impact text,
  urgency text NOT NULL DEFAULT 'normal', -- low | normal | high | critical
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  impacted_document_types text[],
  impacted_workflow_slugs text[],
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_updates_domain_date ON public.legal_updates(domain, effective_date DESC);
CREATE INDEX idx_legal_updates_urgency ON public.legal_updates(urgency, publication_date DESC);
ALTER TABLE public.legal_updates ENABLE ROW LEVEL SECURITY;
-- Veille = global (lecture par tous les utilisateurs connectés ; écriture = super_admin uniquement)
CREATE POLICY "All authenticated read legal updates" ON public.legal_updates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins manage legal updates" ON public.legal_updates FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE TRIGGER trg_legal_updates_updated BEFORE UPDATE ON public.legal_updates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. legal_update_actions — actions liées à une veille (par tenant)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE public.legal_update_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  legal_update_id uuid NOT NULL REFERENCES public.legal_updates(id) ON DELETE CASCADE,
  action_type text NOT NULL, -- create_task | create_reminder | update_template | create_internal_note | notify_users | run_compliance_audit | archive_to_case
  status text NOT NULL DEFAULT 'pending', -- pending | done | skipped
  assigned_to uuid,
  related_dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by uuid NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_update_actions_tenant ON public.legal_update_actions(tenant_id, status);
ALTER TABLE public.legal_update_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view tenant update actions" ON public.legal_update_actions FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert update actions" ON public.legal_update_actions FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Assignee or admin updates actions" ON public.legal_update_actions FOR UPDATE TO authenticated USING (assigned_to = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE POLICY "Admins delete update actions" ON public.legal_update_actions FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE TRIGGER trg_lua_updated BEFORE UPDATE ON public.legal_update_actions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. notification_preferences — préférences utilisateur (1 row par user)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  app_enabled boolean NOT NULL DEFAULT true,
  digest_frequency text NOT NULL DEFAULT 'weekly', -- none | daily | weekly | monthly
  watched_domains text[] NOT NULL DEFAULT ARRAY[]::text[],
  watched_update_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  watched_site_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  watched_client_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  notify_on jsonb NOT NULL DEFAULT '{
    "document_a_valider": true,
    "echeance_proche": true,
    "rappel_retard": true,
    "workflow_bloque": true,
    "risque_detecte": true,
    "rapport_disponible": true,
    "nouvelle_mise_a_jour_juridique": true,
    "action_requise": true
  }'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User reads own prefs" ON public.notification_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "User upserts own prefs" ON public.notification_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "User updates own prefs" ON public.notification_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER trg_npref_updated BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 5. email_queue — file d'attente des emails sortants
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE public.email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recipient_user_id uuid,
  recipient_email text NOT NULL,
  template_key text NOT NULL, -- digest_weekly | digest_monthly | notification | report_ready | invitation
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  status text NOT NULL DEFAULT 'pending', -- pending | sent | failed
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_queue_status_sched ON public.email_queue(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_email_queue_tenant ON public.email_queue(tenant_id, created_at DESC);
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view tenant email queue" ON public.email_queue FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE POLICY "Super admins manage all email queue" ON public.email_queue FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE TRIGGER trg_eq_updated BEFORE UPDATE ON public.email_queue FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 6. document_generation_sessions — sessions de génération en cours
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE public.document_generation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  template_id uuid REFERENCES public.document_templates(id) ON DELETE SET NULL,
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  scenario text NOT NULL DEFAULT 'no_upload', -- no_upload | with_upload | optional_upload
  status text NOT NULL DEFAULT 'in_progress', -- in_progress | awaiting_validation | validated | generated | abandoned
  current_step text,
  collected_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  prefilled_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_document_analysis_id uuid REFERENCES public.document_analyses(id) ON DELETE SET NULL,
  validation_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dgs_tenant_user ON public.document_generation_sessions(tenant_id, user_id, status);
CREATE INDEX idx_dgs_dossier ON public.document_generation_sessions(dossier_id) WHERE dossier_id IS NOT NULL;
ALTER TABLE public.document_generation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view tenant generation sessions" ON public.document_generation_sessions FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert generation sessions" ON public.document_generation_sessions FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id) AND user_id = auth.uid());
CREATE POLICY "Owner updates generation sessions" ON public.document_generation_sessions FOR UPDATE TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE POLICY "Admins delete generation sessions" ON public.document_generation_sessions FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE TRIGGER trg_dgs_updated BEFORE UPDATE ON public.document_generation_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 7. generated_documents — documents générés finaux
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE public.generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  session_id uuid REFERENCES public.document_generation_sessions(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.document_templates(id) ON DELETE SET NULL,
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  generated_by uuid NOT NULL,
  title text NOT NULL,
  content_html text,
  content_markdown text,
  variables_used jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_format text NOT NULL DEFAULT 'pdf', -- pdf | docx | both
  storage_path text, -- path dans dossier-files
  status text NOT NULL DEFAULT 'draft', -- draft | finalized | sent | archived
  validated_by uuid,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gd_tenant_dossier ON public.generated_documents(tenant_id, dossier_id);
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view tenant generated docs" ON public.generated_documents FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert generated docs" ON public.generated_documents FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Owner or admin updates generated docs" ON public.generated_documents FOR UPDATE TO authenticated USING (generated_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE POLICY "Admins delete generated docs" ON public.generated_documents FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE TRIGGER trg_gd_updated BEFORE UPDATE ON public.generated_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 8. extracted_fields — champs extraits d'un document analysé
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE public.extracted_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_analysis_id uuid NOT NULL REFERENCES public.document_analyses(id) ON DELETE CASCADE,
  field_key text NOT NULL, -- parties, objet, date_signature, date_effet, date_fin, duree, renouvellement, preavis, montant, juridiction…
  field_value text,
  field_type text NOT NULL DEFAULT 'text', -- text | date | number | money | boolean | list
  confidence real, -- 0.0 → 1.0
  source_excerpt text, -- extrait du doc d'où vient la valeur
  page_number int,
  validated_by_user boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ef_analysis ON public.extracted_fields(document_analysis_id);
CREATE INDEX idx_ef_tenant_key ON public.extracted_fields(tenant_id, field_key);
ALTER TABLE public.extracted_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view extracted fields" ON public.extracted_fields FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert extracted fields" ON public.extracted_fields FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members update own validated extracted fields" ON public.extracted_fields FOR UPDATE TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Admins delete extracted fields" ON public.extracted_fields FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));

-- ──────────────────────────────────────────────────────────────────────────
-- 9. reports — rapports métier
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  generated_by uuid NOT NULL,
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  report_type text NOT NULL, -- analyse_contrat | risques_juridiques | dossier | rh_mensuel | conformite | veille | procedure_disciplinaire | documents_analyses | echeances | cabinet_par_client
  title text NOT NULL,
  period_start date,
  period_end date,
  executive_summary text,
  context text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb, -- contenu structuré du rapport
  status text NOT NULL DEFAULT 'draft', -- draft | finalized | shared
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_tenant_type ON public.reports(tenant_id, report_type, created_at DESC);
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view tenant reports" ON public.reports FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Owner or admin updates reports" ON public.reports FOR UPDATE TO authenticated USING (generated_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE POLICY "Admins delete reports" ON public.reports FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));
CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 10. report_exports — exports PDF/Word/email/lien partagé
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE public.report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  exported_by uuid NOT NULL,
  format text NOT NULL, -- pdf | docx | email | shared_link
  storage_path text,
  shared_token text UNIQUE, -- pour les liens partagés
  shared_expires_at timestamptz,
  recipient_email text, -- pour les envois par email
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_re_report ON public.report_exports(report_id);
ALTER TABLE public.report_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view tenant report exports" ON public.report_exports FOR SELECT TO authenticated USING (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members insert report exports" ON public.report_exports FOR INSERT TO authenticated WITH CHECK (is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Admins delete report exports" ON public.report_exports FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role, tenant_id));

-- ──────────────────────────────────────────────────────────────────────────
-- Liens optionnels entre dossiers et sites (multi-sites)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.dossiers ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dossiers_site ON public.dossiers(site_id) WHERE site_id IS NOT NULL;