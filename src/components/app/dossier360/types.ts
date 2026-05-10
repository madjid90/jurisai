// G6 — Types partagés Dossier360 (extrait de Dossier360Tabs.tsx).
export type TabKey =
  | "timeline"
  | "risks"
  | "validations"
  | "reminders"
  | "documents"
  | "links"
  | "workflows"
  | "sources"
  | "agent";

export type TimelineEvent = {
  id: string;
  event_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
  actor_id: string | null;
};

export type Risk = {
  id: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string | null;
  legal_basis: unknown;
  mitigation: string | null;
  status: "open" | "mitigating" | "resolved" | "accepted";
  created_at: string;
  resolved_at: string | null;
};

export type Validation = {
  id: string;
  subject_type: string;
  subject_id: string | null;
  comment: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requested_by: string;
  assigned_to: string;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
};

export type Reminder = {
  id: string;
  title: string;
  body: string | null;
  remind_at: string;
  sent_at: string | null;
  dismissed_at: string | null;
  user_id: string;
  created_at: string;
};

export type GeneratedDoc = {
  id: string;
  title: string;
  status: string;
  output_format: string | null;
  template_id: string | null;
  created_at: string;
  validated_at: string | null;
  document_templates: { name: string; category: string | null; risk_level: string | null } | null;
};

export type WorkflowInstance = {
  id: string;
  title: string;
  status: string;
  current_step_index: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  definition_id: string | null;
  workflow_definitions: { slug: string; title: string; category: string | null; steps: unknown } | null;
};

export type SourceRef = { citation: string; count: number; lastSeen: string };

export type Dossier360Data = {
  timeline: TimelineEvent[];
  risks: Risk[];
  validations: Validation[];
  reminders: Reminder[];
  generatedDocuments: GeneratedDoc[];
  workflows: WorkflowInstance[];
  sources: SourceRef[];
};

export const SEVERITY_STYLE: Record<Risk["severity"], string> = {
  low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  high: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  critical: "bg-destructive/10 text-destructive border-destructive/40",
};

export const SEVERITY_LABEL: Record<Risk["severity"], string> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
  critical: "Critique",
};

export const RISK_STATUS_LABEL: Record<Risk["status"], string> = {
  open: "Ouvert",
  mitigating: "En traitement",
  resolved: "Résolu",
  accepted: "Accepté",
};
