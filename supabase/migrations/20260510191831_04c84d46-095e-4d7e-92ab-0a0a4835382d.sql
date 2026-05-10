-- R37/R38 : index de performance pour les requêtes par tenant + dossier
-- Ces index suppriment les scans séquentiels sur les hot paths (Dossier 360, agent, timeline, RGPD)

CREATE INDEX IF NOT EXISTS idx_case_timeline_tenant_dossier_occurred
  ON public.case_timeline_events (tenant_id, dossier_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_identified_risks_tenant_dossier
  ON public.identified_risks (tenant_id, dossier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_validation_requests_tenant_dossier
  ON public.validation_requests (tenant_id, dossier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reminders_tenant_dossier_remind
  ON public.reminders (tenant_id, dossier_id, remind_at);

CREATE INDEX IF NOT EXISTS idx_generated_documents_tenant_dossier
  ON public.generated_documents (tenant_id, dossier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_tenant_dossier
  ON public.workflow_instances (tenant_id, dossier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dossiers_tenant_status_updated
  ON public.dossiers (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, read_at) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_document_analyses_tenant_created
  ON public.document_analyses (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_tenant
  ON public.user_roles (user_id, tenant_id);
