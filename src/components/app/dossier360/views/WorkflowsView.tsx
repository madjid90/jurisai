// G6 — WorkflowsView extrait de Dossier360Tabs.
import { Link } from "@tanstack/react-router";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { Empty } from "../shared";
import type { WorkflowInstance } from "../types";

const WF_STATUS_STYLE: Record<string, string> = {
  draft: "bg-secondary text-foreground",
  active: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  in_progress: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  paused: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  cancelled: "bg-muted text-muted-foreground",
};

export function WorkflowsView({ workflows }: { workflows: WorkflowInstance[] }) {
  if (workflows.length === 0) {
    return <Empty icon={GitBranch} title="Aucun workflow lancé" hint="Démarrez un workflow (licenciement, mise en demeure, RGPD…) pour piloter le dossier étape par étape." />;
  }
  return (
    <ul className="space-y-2">
      {workflows.map((w) => {
        const steps = Array.isArray(w.workflow_definitions?.steps) ? (w.workflow_definitions!.steps as unknown[]) : [];
        const total = steps.length;
        const current = (w.current_step_index ?? 0) + 1;
        const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
        return (
          <li key={w.id} className="rounded-xl border border-border/60 bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-foreground">{w.title}</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {w.workflow_definitions?.title ?? "Workflow personnalisé"}
                  {total > 0 ? ` · Étape ${Math.min(current, total)}/${total}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("rounded-md border px-2 py-0.5 text-[10.5px] font-medium", WF_STATUS_STYLE[w.status] ?? "bg-secondary text-foreground border-border")}>
                  {w.status}
                </span>
                <Link to="/workflows/$id" params={{ id: w.id }} className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-secondary">
                  Ouvrir
                </Link>
              </div>
            </div>
            {total > 0 && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
