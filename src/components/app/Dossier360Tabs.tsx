import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  GitBranch,
  Loader2,
  Plus,
  Shield,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  createReminder,
  createRisk,
  decideValidation,
  dismissReminder,
  getDossier360,
  requestValidation,
  updateRiskStatus,
} from "@/server/dossier360.functions";
import { runLegalAgent } from "@/server/agent.functions";

type TabKey = "timeline" | "risks" | "validations" | "reminders" | "documents" | "workflows" | "sources" | "agent";

type TimelineEvent = {
  id: string;
  event_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
  actor_id: string | null;
};

type Risk = {
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

type Validation = {
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

type Reminder = {
  id: string;
  title: string;
  body: string | null;
  remind_at: string;
  sent_at: string | null;
  dismissed_at: string | null;
  user_id: string;
  created_at: string;
};

type GeneratedDoc = {
  id: string;
  title: string;
  status: string;
  output_format: string | null;
  template_id: string | null;
  created_at: string;
  validated_at: string | null;
  document_templates: { name: string; category: string | null; risk_level: string | null } | null;
};

type WorkflowInstance = {
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

type SourceRef = { citation: string; count: number; lastSeen: string };

const SEVERITY_STYLE: Record<Risk["severity"], string> = {
  low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  high: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  critical: "bg-destructive/10 text-destructive border-destructive/40",
};

const SEVERITY_LABEL: Record<Risk["severity"], string> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
  critical: "Critique",
};

const RISK_STATUS_LABEL: Record<Risk["status"], string> = {
  open: "Ouvert",
  mitigating: "En traitement",
  resolved: "Résolu",
  accepted: "Accepté",
};

export function Dossier360Tabs({ dossierId }: { dossierId: string }) {
  const [tab, setTab] = useState<TabKey>("timeline");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    timeline: TimelineEvent[];
    risks: Risk[];
    validations: Validation[];
    reminders: Reminder[];
    generatedDocuments: GeneratedDoc[];
    workflows: WorkflowInstance[];
    sources: SourceRef[];
  }>({ timeline: [], risks: [], validations: [], reminders: [], generatedDocuments: [], workflows: [], sources: [] });

  const [showRiskModal, setShowRiskModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);

  const get360 = useServerFn(getDossier360);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await get360({ data: { dossierId } });
      setData(res as typeof data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur 360°");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  const tabs: Array<{ key: TabKey; label: string; count?: number; icon: typeof Clock }> = [
    { key: "timeline", label: "Timeline", count: data.timeline.length, icon: Clock },
    {
      key: "risks",
      label: "Risques",
      count: data.risks.filter((r) => r.status !== "resolved").length,
      icon: Shield,
    },
    {
      key: "validations",
      label: "Validations",
      count: data.validations.filter((v) => v.status === "pending").length,
      icon: CheckCircle2,
    },
    {
      key: "reminders",
      label: "Rappels",
      count: data.reminders.filter((r) => !r.dismissed_at).length,
      icon: Bell,
    },
    {
      key: "documents",
      label: "Documents",
      count: data.generatedDocuments.length,
      icon: FileText,
    },
    {
      key: "workflows",
      label: "Workflows",
      count: data.workflows.filter((w) => w.status !== "completed" && w.status !== "cancelled").length,
      icon: GitBranch,
    },
    {
      key: "sources",
      label: "Sources",
      count: data.sources.length,
      icon: BookOpen,
    },
    { key: "agent", label: "Agent IA", icon: Sparkles },
  ];

  // Synthèse "Actions recommandées" : risques critiques ouverts + validations en attente +
  // rappels en retard ou imminents (24h).
  const now = Date.now();
  const criticalRisks = data.risks.filter(
    (r) => r.status !== "resolved" && (r.severity === "critical" || r.severity === "high"),
  );
  const pendingValidations = data.validations.filter((v) => v.status === "pending");
  const upcomingReminders = data.reminders.filter(
    (r) => !r.dismissed_at && new Date(r.remind_at).getTime() <= now + 24 * 60 * 60 * 1000,
  );
  const totalActions = criticalRisks.length + pendingValidations.length + upcomingReminders.length;

  return (
    <section className="mt-6 rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
      {/* Panneau Actions recommandées */}
      {!loading && totalActions > 0 && (
        <div className="border-b border-border bg-amber-500/5 px-5 py-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h3 className="text-[12.5px] font-semibold text-foreground">
              Actions recommandées ({totalActions})
            </h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {criticalRisks.length > 0 && (
              <button
                onClick={() => setTab("risks")}
                className="rounded-lg border border-destructive/30 bg-card p-2.5 text-left transition hover:border-destructive/60"
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Risques élevés
                </p>
                <p className="mt-0.5 text-[18px] font-bold text-destructive">
                  {criticalRisks.length}
                </p>
                <p className="text-[11px] text-muted-foreground">à traiter en priorité</p>
              </button>
            )}
            {pendingValidations.length > 0 && (
              <button
                onClick={() => setTab("validations")}
                className="rounded-lg border border-amber-500/30 bg-card p-2.5 text-left transition hover:border-amber-500/60"
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Validations
                </p>
                <p className="mt-0.5 text-[18px] font-bold text-amber-600">
                  {pendingValidations.length}
                </p>
                <p className="text-[11px] text-muted-foreground">en attente</p>
              </button>
            )}
            {upcomingReminders.length > 0 && (
              <button
                onClick={() => setTab("reminders")}
                className="rounded-lg border border-blue-500/30 bg-card p-2.5 text-left transition hover:border-blue-500/60"
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Rappels
                </p>
                <p className="mt-0.5 text-[18px] font-bold text-blue-600">
                  {upcomingReminders.length}
                </p>
                <p className="text-[11px] text-muted-foreground">dans les 24h</p>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tabs header */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-[12.5px] font-medium transition",
                active
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {typeof t.count === "number" && t.count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold",
                    active ? "bg-accent text-accent-foreground" : "bg-secondary text-foreground",
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-[280px] p-5">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          </div>
        ) : (
          <>
            {tab === "timeline" && <TimelineView events={data.timeline} />}
            {tab === "risks" && (
              <RisksView
                risks={data.risks}
                onAdd={() => setShowRiskModal(true)}
                onChanged={refresh}
              />
            )}
            {tab === "validations" && (
              <ValidationsView
                validations={data.validations}
                onAdd={() => setShowValidationModal(true)}
                onChanged={refresh}
              />
            )}
            {tab === "reminders" && (
              <RemindersView
                reminders={data.reminders}
                onAdd={() => setShowReminderModal(true)}
                onChanged={refresh}
              />
            )}
            {tab === "documents" && <DocumentsView docs={data.generatedDocuments} />}
            {tab === "workflows" && <WorkflowsView workflows={data.workflows} />}
            {tab === "sources" && <SourcesView sources={data.sources} />}
            {tab === "agent" && <AgentDossierPanel dossierId={dossierId} onActed={refresh} />}
          </>
        )}
      </div>

      {showRiskModal && (
        <RiskModal
          dossierId={dossierId}
          onClose={() => setShowRiskModal(false)}
          onSaved={() => {
            setShowRiskModal(false);
            void refresh();
          }}
        />
      )}
      {showReminderModal && (
        <ReminderModal
          dossierId={dossierId}
          onClose={() => setShowReminderModal(false)}
          onSaved={() => {
            setShowReminderModal(false);
            void refresh();
          }}
        />
      )}
      {showValidationModal && (
        <ValidationModal
          dossierId={dossierId}
          onClose={() => setShowValidationModal(false)}
          onSaved={() => {
            setShowValidationModal(false);
            void refresh();
          }}
        />
      )}
    </section>
  );
}

// ─── TIMELINE ────────────────────────────────────────────────────────────

type TimelineFilter =
  | "all"
  | "questions"
  | "documents"
  | "analyses"
  | "risques"
  | "workflows"
  | "echeances"
  | "validations"
  | "rappels"
  | "rapports"
  | "exports";

function classifyEvent(eventType: string): TimelineFilter {
  const t = eventType.toLowerCase();
  if (t.startsWith("agent.") || t.startsWith("question.") || t.startsWith("chat.")) return "questions";
  if (t.startsWith("document.") || t.startsWith("doc.")) return "documents";
  if (t.startsWith("analysis.") || t.startsWith("analyse.")) return "analyses";
  if (t.startsWith("risk.") || t.startsWith("risque.")) return "risques";
  if (t.startsWith("workflow.")) return "workflows";
  if (t.startsWith("deadline.") || t.startsWith("echeance.")) return "echeances";
  if (t.startsWith("validation.")) return "validations";
  if (t.startsWith("reminder.") || t.startsWith("rappel.")) return "rappels";
  if (t.startsWith("report.") || t.startsWith("rapport.")) return "rapports";
  if (t.startsWith("export.")) return "exports";
  return "all";
}

const TIMELINE_FILTERS: Array<{ key: TimelineFilter; label: string }> = [
  { key: "all", label: "Tout" },
  { key: "questions", label: "Questions" },
  { key: "documents", label: "Documents" },
  { key: "analyses", label: "Analyses" },
  { key: "risques", label: "Risques" },
  { key: "workflows", label: "Workflows" },
  { key: "echeances", label: "Échéances" },
  { key: "validations", label: "Validations" },
  { key: "rappels", label: "Rappels" },
  { key: "rapports", label: "Rapports" },
  { key: "exports", label: "Exports" },
];

function TimelineView({ events }: { events: TimelineEvent[] }) {
  const [filter, setFilter] = useState<TimelineFilter>("all");

  const filtered = filter === "all" ? events : events.filter((e) => classifyEvent(e.event_type) === filter);

  // Compteurs par catégorie pour afficher seulement celles qui ont des éléments
  const counts = events.reduce<Record<TimelineFilter, number>>(
    (acc, e) => {
      const cat = classifyEvent(e.event_type);
      acc[cat] = (acc[cat] ?? 0) + 1;
      acc.all = (acc.all ?? 0) + 1;
      return acc;
    },
    {
      all: 0, questions: 0, documents: 0, analyses: 0, risques: 0,
      workflows: 0, echeances: 0, validations: 0, rappels: 0, rapports: 0, exports: 0,
    },
  );

  if (events.length === 0) {
    return (
      <Empty
        icon={Clock}
        title="Aucun événement enregistré"
        hint="La timeline se remplit automatiquement quand vous (ou l'agent) agissez sur le dossier."
      />
    );
  }

  return (
    <div>
      {/* Filtres */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TIMELINE_FILTERS.filter((f) => counts[f.key] > 0).map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition",
                active
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-secondary",
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px]",
                  active ? "bg-accent-foreground/20" : "bg-secondary",
                )}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground">
          Aucun événement dans cette catégorie.
        </p>
      ) : (
        <ol className="relative space-y-3 border-l border-border pl-5">
          {filtered.map((e) => {
            const isAgent =
              (e.metadata as { source?: string } | null)?.source === "agent";
            return (
              <li key={e.id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[26px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 bg-card",
                    isAgent ? "border-accent" : "border-primary",
                  )}
                />
                <div className="rounded-xl border border-border/60 bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] font-semibold text-foreground">{e.title}</p>
                    <time className="whitespace-nowrap text-[11px] text-muted-foreground">
                      {new Date(e.occurred_at).toLocaleString("fr-FR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  {e.description && (
                    <p className="mt-1 text-[12px] text-muted-foreground">{e.description}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      {e.event_type}
                    </span>
                    {isAgent && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-soft-foreground">
                        <Sparkles className="h-2.5 w-2.5" /> agent
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ─── RISQUES ─────────────────────────────────────────────────────────────

function RisksView({
  risks,
  onAdd,
  onChanged,
}: {
  risks: Risk[];
  onAdd: () => void;
  onChanged: () => void;
}) {
  const updateFn = useServerFn(updateRiskStatus);
  const handleStatus = async (riskId: string, status: Risk["status"]) => {
    try {
      await updateFn({ data: { riskId, status } });
      toast.success("Statut mis à jour");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div>
      <SectionHeader title="Risques juridiques" onAdd={onAdd} addLabel="Identifier un risque" />
      {risks.length === 0 ? (
        <Empty
          icon={Shield}
          title="Aucun risque identifié"
          hint="Identifiez les risques juridiques (rupture, conformité, contentieux…) pour les suivre."
        />
      ) : (
        <div className="space-y-2">
          {risks.map((r) => (
            <div
              key={r.id}
              className={cn(
                "rounded-xl border p-3",
                r.status === "resolved" ? "opacity-60" : "",
                "border-border/60 bg-background",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase",
                        SEVERITY_STYLE[r.severity],
                      )}
                    >
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {SEVERITY_LABEL[r.severity]}
                    </span>
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                      {r.category}
                    </span>
                    <span className="text-[10.5px] text-muted-foreground">
                      {RISK_STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] font-semibold text-foreground">{r.title}</p>
                  {r.description && (
                    <p className="mt-1 text-[12px] text-muted-foreground">{r.description}</p>
                  )}
                  {Array.isArray(r.legal_basis) && r.legal_basis.length > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Base légale :{" "}
                      {(r.legal_basis as Array<{ source?: string }>)
                        .map((b) => b.source)
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {r.mitigation && (
                    <p className="mt-1 rounded-md bg-secondary/50 p-1.5 text-[11.5px] text-foreground">
                      <span className="font-semibold">Mitigation : </span>
                      {r.mitigation}
                    </p>
                  )}
                </div>
                <select
                  value={r.status}
                  onChange={(e) => handleStatus(r.id, e.target.value as Risk["status"])}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-[11.5px]"
                >
                  <option value="open">Ouvert</option>
                  <option value="mitigating">En traitement</option>
                  <option value="resolved">Résolu</option>
                  <option value="accepted">Accepté</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── VALIDATIONS ─────────────────────────────────────────────────────────

function ValidationsView({
  validations,
  onAdd,
  onChanged,
}: {
  validations: Validation[];
  onAdd: () => void;
  onChanged: () => void;
}) {
  const decideFn = useServerFn(decideValidation);
  const handle = async (id: string, decision: "approved" | "rejected") => {
    try {
      await decideFn({ data: { validationId: id, decision } });
      toast.success(decision === "approved" ? "Approuvé" : "Rejeté");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div>
      <SectionHeader title="Validations" onAdd={onAdd} addLabel="Demander une validation" />
      {validations.length === 0 ? (
        <Empty
          icon={CheckCircle2}
          title="Aucune validation"
          hint="Pour les actions engageantes, demandez une validation hiérarchique."
        />
      ) : (
        <div className="space-y-2">
          {validations.map((v) => (
            <div key={v.id} className="rounded-xl border border-border/60 bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-foreground">{v.subject_type}</p>
                  {v.comment && (
                    <p className="mt-1 text-[12px] text-muted-foreground">{v.comment}</p>
                  )}
                  <p className="mt-1 text-[10.5px] text-muted-foreground">
                    Demandé le {new Date(v.created_at).toLocaleDateString("fr-FR")}
                  </p>
                  {v.decision_comment && (
                    <p className="mt-1 rounded-md bg-secondary/50 p-1.5 text-[11.5px]">
                      Décision : {v.decision_comment}
                    </p>
                  )}
                </div>
                {v.status === "pending" ? (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handle(v.id, "approved")}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-500/40 px-2 text-[11.5px] font-medium text-emerald-600 hover:bg-emerald-500/10"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Approuver
                    </button>
                    <button
                      onClick={() => handle(v.id, "rejected")}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-destructive/40 px-2 text-[11.5px] font-medium text-destructive hover:bg-destructive/10"
                    >
                      <XCircle className="h-3 w-3" />
                      Rejeter
                    </button>
                  </div>
                ) : (
                  <span
                    className={cn(
                      "rounded-md px-2 py-1 text-[10.5px] font-semibold uppercase",
                      v.status === "approved"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {v.status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── RAPPELS ─────────────────────────────────────────────────────────────

function RemindersView({
  reminders,
  onAdd,
  onChanged,
}: {
  reminders: Reminder[];
  onAdd: () => void;
  onChanged: () => void;
}) {
  const dismissFn = useServerFn(dismissReminder);
  const handleDismiss = async (id: string) => {
    try {
      await dismissFn({ data: { reminderId: id } });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div>
      <SectionHeader title="Rappels" onAdd={onAdd} addLabel="Programmer un rappel" />
      {reminders.length === 0 ? (
        <Empty
          icon={Bell}
          title="Aucun rappel programmé"
          hint="Programmez des rappels pour ne rien oublier (renouvellement, échéance…)."
        />
      ) : (
        <div className="space-y-2">
          {reminders.map((r) => {
            const dt = new Date(r.remind_at);
            const past = dt < new Date();
            return (
              <div
                key={r.id}
                className={cn(
                  "flex items-center justify-between rounded-xl border border-border/60 bg-background p-3",
                  r.dismissed_at && "opacity-50",
                )}
              >
                <div>
                  <p className="text-[13px] font-semibold text-foreground">{r.title}</p>
                  {r.body && <p className="mt-0.5 text-[12px] text-muted-foreground">{r.body}</p>}
                  <p
                    className={cn(
                      "mt-1 text-[11px]",
                      past && !r.dismissed_at ? "font-semibold text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {dt.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                {!r.dismissed_at && (
                  <button
                    onClick={() => handleDismiss(r.id)}
                    className="rounded-lg border border-border px-2 py-1 text-[11.5px] hover:bg-secondary"
                  >
                    Marquer fait
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── AGENT contextuel ────────────────────────────────────────────────────

function AgentDossierPanel({ dossierId, onActed }: { dossierId: string; onActed: () => void }) {
  const runFn = useServerFn(runLegalAgent);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [exchange, setExchange] = useState<{
    answer: string;
    sources: Array<{ n: number; title: string; ref: string | null; url: string | null }>;
    intent: { intent: string; domain: string; confidence: number } | null;
    trace: Array<{ tool: string }>;
  } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      const res = await runFn({ data: { message: input.trim(), dossier_id: dossierId } });
      setExchange({
        answer: res.answer,
        sources: res.sources,
        intent: { intent: res.intent, domain: res.domain, confidence: res.confidence },
        trace: res.trace.map((t) => ({ tool: t.tool })),
      });
      setInput("");
      onActed();
    } catch (e2) {
      toast.error(e2 instanceof Error ? e2.message : "Erreur agent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
        <div className="text-[12px] text-foreground">
          <p className="font-semibold">Agent contextuel</p>
          <p className="mt-0.5 text-muted-foreground">
            L'agent connaît ce dossier. Il peut sourcer, identifier des risques, créer des tâches, demander des validations, programmer des rappels.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          placeholder="Ex : Identifie les risques juridiques de ce dossier et propose un plan d'action."
          disabled={busy}
          className="w-full rounded-xl border border-border bg-background p-3 text-[13px] outline-none focus:border-accent disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-br from-primary to-accent px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? "L'agent réfléchit…" : "Demander à l'agent"}
        </button>
      </form>

      {exchange && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-background p-4">
          {exchange.intent && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-muted-foreground">
                intention : <strong>{exchange.intent.intent}</strong>
              </span>
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-muted-foreground">
                domaine : <strong>{exchange.intent.domain}</strong>
              </span>
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-muted-foreground">
                confiance : <strong>{Math.round(exchange.intent.confidence * 100)}%</strong>
              </span>
            </div>
          )}
          <div className="prose prose-sm max-w-none text-[13px] text-foreground whitespace-pre-wrap">
            {exchange.answer}
          </div>
          {exchange.sources.length > 0 && (
            <div className="border-t border-border pt-2">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sources
              </p>
              <ul className="mt-1.5 space-y-1">
                {exchange.sources.map((s) => (
                  <li key={s.n} className="text-[11.5px]">
                    <span className="font-mono text-accent">[{s.n}]</span>{" "}
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                        {s.title}
                      </a>
                    ) : (
                      <span>{s.title}</span>
                    )}
                    {s.ref && <span className="text-muted-foreground"> · {s.ref}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {exchange.trace.length > 0 && (
            <p className="text-[10.5px] text-muted-foreground">
              Outils utilisés : {exchange.trace.map((t) => t.tool).join(" → ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers UI ──────────────────────────────────────────────────────────

function SectionHeader({
  title,
  onAdd,
  addLabel,
}: {
  title: string;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <button
        onClick={onAdd}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-[12px] font-medium text-foreground hover:bg-accent-soft"
      >
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </button>
    </div>
  );
}

function Empty({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Clock;
  title: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <Icon className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-2 text-[13px] font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[11.5px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-md rounded-2xl p-5 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── MODALS ──────────────────────────────────────────────────────────────

function RiskModal({
  dossierId,
  onClose,
  onSaved,
}: {
  dossierId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    severity: "medium" as Risk["severity"],
    category: "general",
    description: "",
    legalBasis: "",
    mitigation: "",
  });
  const createFn = useServerFn(createRisk);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      await createFn({
        data: {
          dossierId,
          title: form.title,
          severity: form.severity,
          category: form.category || undefined,
          description: form.description || undefined,
          legalBasis: form.legalBasis || undefined,
          mitigation: form.mitigation || undefined,
        },
      });
      toast.success("Risque enregistré");
      onSaved();
    } catch (e2) {
      toast.error(e2 instanceof Error ? e2.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Identifier un risque" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Intitulé">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            className="input-base"
          />
        </Input>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Gravité">
            <select
              value={form.severity}
              onChange={(e) =>
                setForm({ ...form, severity: e.target.value as Risk["severity"] })
              }
              className="input-base"
            >
              <option value="low">Faible</option>
              <option value="medium">Moyen</option>
              <option value="high">Élevé</option>
              <option value="critical">Critique</option>
            </select>
          </Input>
          <Input label="Catégorie">
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="input-base"
              placeholder="rh, commercial, rgpd…"
            />
          </Input>
        </div>
        <Input label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="input-base"
          />
        </Input>
        <Input label="Base légale (article, source)">
          <input
            value={form.legalBasis}
            onChange={(e) => setForm({ ...form, legalBasis: e.target.value })}
            className="input-base"
            placeholder="Ex : Art. L1234-1 Code du travail"
          />
        </Input>
        <Input label="Mesure de mitigation envisagée">
          <textarea
            value={form.mitigation}
            onChange={(e) => setForm({ ...form, mitigation: e.target.value })}
            rows={2}
            className="input-base"
          />
        </Input>
        <SubmitRow busy={busy} onClose={onClose} label="Enregistrer le risque" />
      </form>
    </ModalShell>
  );
}

function ReminderModal({
  dossierId,
  onClose,
  onSaved,
}: {
  dossierId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", remindAt: "" });
  const createFn = useServerFn(createReminder);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.remindAt) return;
    setBusy(true);
    try {
      await createFn({
        data: {
          dossierId,
          title: form.title,
          body: form.body || undefined,
          remindAt: new Date(form.remindAt).toISOString(),
        },
      });
      toast.success("Rappel programmé");
      onSaved();
    } catch (e2) {
      toast.error(e2 instanceof Error ? e2.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Programmer un rappel" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Intitulé">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            className="input-base"
          />
        </Input>
        <Input label="Date et heure">
          <input
            type="datetime-local"
            value={form.remindAt}
            onChange={(e) => setForm({ ...form, remindAt: e.target.value })}
            required
            className="input-base"
          />
        </Input>
        <Input label="Note">
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={2}
            className="input-base"
          />
        </Input>
        <SubmitRow busy={busy} onClose={onClose} label="Programmer" />
      </form>
    </ModalShell>
  );
}

function ValidationModal({
  dossierId,
  onClose,
  onSaved,
}: {
  dossierId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ subjectType: "", comment: "" });
  const createFn = useServerFn(requestValidation);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.subjectType.trim()) return;
    setBusy(true);
    try {
      await createFn({
        data: {
          dossierId,
          subjectType: form.subjectType,
          comment: form.comment || undefined,
        },
      });
      toast.success("Validation demandée");
      onSaved();
    } catch (e2) {
      toast.error(e2 instanceof Error ? e2.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Demander une validation" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Objet de la validation">
          <input
            value={form.subjectType}
            onChange={(e) => setForm({ ...form, subjectType: e.target.value })}
            required
            className="input-base"
            placeholder="Ex : envoi lettre licenciement, signature contrat…"
          />
        </Input>
        <Input label="Commentaire pour le validateur">
          <textarea
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
            rows={3}
            className="input-base"
          />
        </Input>
        <p className="text-[11px] text-muted-foreground">
          La demande sera assignée automatiquement à un administrateur du cabinet.
        </p>
        <SubmitRow busy={busy} onClose={onClose} label="Envoyer la demande" />
      </form>
    </ModalShell>
  );
}

function Input({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function SubmitRow({
  busy,
  onClose,
  label,
}: {
  busy: boolean;
  onClose: () => void;
  label: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onClose}
        className="h-9 rounded-xl border border-border px-3 text-[12.5px] hover:bg-secondary"
      >
        Annuler
      </button>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-br from-primary to-accent px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {label}
      </button>
    </div>
  );
}
