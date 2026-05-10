// G6 — DocumentsView extrait de Dossier360Tabs.
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Empty } from "../shared";
import type { GeneratedDoc } from "../types";

const DOC_STATUS_STYLE: Record<string, string> = {
  draft: "bg-secondary text-foreground",
  pending_validation: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  validated: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/40",
  archived: "bg-muted text-muted-foreground",
};

const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  pending_validation: "À valider",
  validated: "Validé",
  rejected: "Rejeté",
  archived: "Archivé",
};

export function DocumentsView({ docs }: { docs: GeneratedDoc[] }) {
  if (docs.length === 0) {
    return <Empty icon={FileText} title="Aucun document généré" hint="Lancez une génération depuis la bibliothèque de modèles ou via l'agent IA." />;
  }
  return (
    <ul className="space-y-2">
      {docs.map((d) => (
        <li key={d.id} className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-background p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-foreground">{d.title}</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {d.document_templates?.name ?? "Modèle inconnu"}
              {d.document_templates?.category ? ` · ${d.document_templates.category}` : ""}
              {" · "}
              {new Date(d.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("rounded-md border px-2 py-0.5 text-[10.5px] font-medium", DOC_STATUS_STYLE[d.status] ?? "bg-secondary text-foreground border-border")}>
              {DOC_STATUS_LABEL[d.status] ?? d.status}
            </span>
            <Link to="/documents/$id" params={{ id: d.id }} className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-secondary">
              Ouvrir
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
