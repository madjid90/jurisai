// G6 — SourcesView extrait de Dossier360Tabs.
import { BookOpen } from "lucide-react";
import { Empty } from "../shared";
import type { SourceRef } from "../types";

export function SourcesView({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) {
    return (
      <Empty
        icon={BookOpen}
        title="Aucune source citée"
        hint="Les références juridiques apparaissent ici dès que l'agent ou un risque cite un texte (Code du travail, jurisprudence, convention collective…)."
      />
    );
  }
  return (
    <ul className="space-y-1.5">
      {sources.map((s) => (
        <li key={s.citation} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-background px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-foreground">{s.citation}</p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">
              Dernière citation : {new Date(s.lastSeen).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
            </p>
          </div>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold text-foreground">×{s.count}</span>
        </li>
      ))}
    </ul>
  );
}
