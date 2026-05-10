// G6 (BUG-G6) — Refactoring : ce fichier était un monolithe de 1627 lignes.
// Il est désormais un orchestrateur (~250 l) qui délègue chaque onglet/modal
// à un composant dédié dans src/components/app/dossier360/.
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  GitBranch,
  Link2,
  Loader2,
  Shield,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getDossier360 } from "@/server/dossier360.functions";

import type { Dossier360Data, TabKey } from "./dossier360/types";
import { TimelineView } from "./dossier360/views/TimelineView";
import { RisksView } from "./dossier360/views/RisksView";
import { ValidationsView } from "./dossier360/views/ValidationsView";
import { RemindersView } from "./dossier360/views/RemindersView";
import { DocumentsView } from "./dossier360/views/DocumentsView";
import { WorkflowsView } from "./dossier360/views/WorkflowsView";
import { LinksView } from "./dossier360/views/LinksView";
import { SourcesView } from "./dossier360/views/SourcesView";
import { AgentDossierPanel } from "./dossier360/views/AgentDossierPanel";
import { RiskModal } from "./dossier360/modals/RiskModal";
import { ReminderModal } from "./dossier360/modals/ReminderModal";
import { ValidationModal } from "./dossier360/modals/ValidationModal";

const EMPTY: Dossier360Data = {
  timeline: [],
  risks: [],
  validations: [],
  reminders: [],
  generatedDocuments: [],
  workflows: [],
  sources: [],
};

export function Dossier360Tabs({ dossierId }: { dossierId: string }) {
  const [tab, setTab] = useState<TabKey>("timeline");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Dossier360Data>(EMPTY);

  const [showRiskModal, setShowRiskModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);

  const get360 = useServerFn(getDossier360);

  // R62 (BUG-G7) — useCallback pour éviter une closure stale sur `dossierId`.
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get360({ data: { dossierId } });
      setData(res as Dossier360Data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur 360°");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tabs: Array<{ key: TabKey; label: string; count?: number; icon: typeof Clock }> = [
    { key: "timeline", label: "Timeline", count: data.timeline.length, icon: Clock },
    { key: "risks", label: "Risques", count: data.risks.filter((r) => r.status !== "resolved").length, icon: Shield },
    { key: "validations", label: "Validations", count: data.validations.filter((v) => v.status === "pending").length, icon: CheckCircle2 },
    { key: "reminders", label: "Rappels", count: data.reminders.filter((r) => !r.dismissed_at).length, icon: Bell },
    { key: "documents", label: "Documents", count: data.generatedDocuments.length, icon: FileText },
    { key: "links", label: "Liaisons", icon: Link2 },
    { key: "workflows", label: "Workflows", count: data.workflows.filter((w) => w.status !== "completed" && w.status !== "cancelled").length, icon: GitBranch },
    { key: "sources", label: "Sources", count: data.sources.length, icon: BookOpen },
    { key: "agent", label: "Agent IA", icon: Sparkles },
  ];

  // Synthèse "Actions recommandées".
  const now = Date.now();
  const criticalRisks = data.risks.filter((r) => r.status !== "resolved" && (r.severity === "critical" || r.severity === "high"));
  const pendingValidations = data.validations.filter((v) => v.status === "pending");
  const upcomingReminders = data.reminders.filter((r) => !r.dismissed_at && new Date(r.remind_at).getTime() <= now + 24 * 60 * 60 * 1000);
  const totalActions = criticalRisks.length + pendingValidations.length + upcomingReminders.length;

  return (
    <section className="mt-6 rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
      {!loading && totalActions > 0 && (
        <div className="border-b border-border bg-amber-500/5 px-5 py-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h3 className="text-[12.5px] font-semibold text-foreground">Actions recommandées ({totalActions})</h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {criticalRisks.length > 0 && (
              <button onClick={() => setTab("risks")} className="rounded-lg border border-destructive/30 bg-card p-2.5 text-left transition hover:border-destructive/60">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Risques élevés</p>
                <p className="mt-0.5 text-[18px] font-bold text-destructive">{criticalRisks.length}</p>
                <p className="text-[11px] text-muted-foreground">à traiter en priorité</p>
              </button>
            )}
            {pendingValidations.length > 0 && (
              <button onClick={() => setTab("validations")} className="rounded-lg border border-amber-500/30 bg-card p-2.5 text-left transition hover:border-amber-500/60">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Validations</p>
                <p className="mt-0.5 text-[18px] font-bold text-amber-600">{pendingValidations.length}</p>
                <p className="text-[11px] text-muted-foreground">en attente</p>
              </button>
            )}
            {upcomingReminders.length > 0 && (
              <button onClick={() => setTab("reminders")} className="rounded-lg border border-blue-500/30 bg-card p-2.5 text-left transition hover:border-blue-500/60">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rappels</p>
                <p className="mt-0.5 text-[18px] font-bold text-blue-600">{upcomingReminders.length}</p>
                <p className="text-[11px] text-muted-foreground">dans les 24h</p>
              </button>
            )}
          </div>
        </div>
      )}

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
                active ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {typeof t.count === "number" && t.count > 0 && (
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold", active ? "bg-accent text-accent-foreground" : "bg-secondary text-foreground")}>
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
            {tab === "risks" && <RisksView risks={data.risks} dossierId={dossierId} onAdd={() => setShowRiskModal(true)} onChanged={refresh} />}
            {tab === "validations" && <ValidationsView validations={data.validations} onAdd={() => setShowValidationModal(true)} onChanged={refresh} />}
            {tab === "reminders" && <RemindersView reminders={data.reminders} onAdd={() => setShowReminderModal(true)} onChanged={refresh} />}
            {tab === "documents" && <DocumentsView docs={data.generatedDocuments} />}
            {tab === "links" && <LinksView dossierId={dossierId} />}
            {tab === "workflows" && <WorkflowsView workflows={data.workflows} />}
            {tab === "sources" && <SourcesView sources={data.sources} />}
            {tab === "agent" && <AgentDossierPanel dossierId={dossierId} onActed={refresh} />}
          </>
        )}
      </div>

      {showRiskModal && (
        <RiskModal dossierId={dossierId} onClose={() => setShowRiskModal(false)} onSaved={() => { setShowRiskModal(false); void refresh(); }} />
      )}
      {showReminderModal && (
        <ReminderModal dossierId={dossierId} onClose={() => setShowReminderModal(false)} onSaved={() => { setShowReminderModal(false); void refresh(); }} />
      )}
      {showValidationModal && (
        <ValidationModal dossierId={dossierId} onClose={() => setShowValidationModal(false)} onSaved={() => { setShowValidationModal(false); void refresh(); }} />
      )}
    </section>
  );
}
