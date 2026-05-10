// G6 — TimelineView extrait de Dossier360Tabs.
import { useState } from "react";
import { Clock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Empty } from "../shared";
import type { TimelineEvent } from "../types";

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

export function TimelineView({ events }: { events: TimelineEvent[] }) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const filtered = filter === "all" ? events : events.filter((e) => classifyEvent(e.event_type) === filter);

  const counts = events.reduce<Record<TimelineFilter, number>>(
    (acc, e) => {
      const cat = classifyEvent(e.event_type);
      acc[cat] = (acc[cat] ?? 0) + 1;
      acc.all = (acc.all ?? 0) + 1;
      return acc;
    },
    { all: 0, questions: 0, documents: 0, analyses: 0, risques: 0, workflows: 0, echeances: 0, validations: 0, rappels: 0, rapports: 0, exports: 0 },
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
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TIMELINE_FILTERS.filter((f) => counts[f.key] > 0).map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition",
                active ? "border-accent bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
              )}
            >
              {f.label}
              <span className={cn("rounded-full px-1.5 text-[10px]", active ? "bg-accent-foreground/20" : "bg-secondary")}>
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
            const isAgent = (e.metadata as { source?: string } | null)?.source === "agent";
            return (
              <li key={e.id} className="relative">
                <span className={cn("absolute -left-[26px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 bg-card", isAgent ? "border-accent" : "border-primary")} />
                <div className="rounded-xl border border-border/60 bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] font-semibold text-foreground">{e.title}</p>
                    <time className="whitespace-nowrap text-[11px] text-muted-foreground">
                      {new Date(e.occurred_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </time>
                  </div>
                  {e.description && <p className="mt-1 text-[12px] text-muted-foreground">{e.description}</p>}
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{e.event_type}</span>
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
