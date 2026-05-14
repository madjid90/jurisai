// DossierSelectionView — l'agent a trouvé plusieurs dossiers candidats.
// On affiche des cartes multi-choix : l'utilisateur clique pour rattacher
// ou ouvre directement le dossier (lien direct).

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FolderOpen, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { attachRunToDossier } from "@/lib/agent/agent-runs.functions";
import type { AgentRun } from "../ResultRenderer";

export function DossierSelectionView({ run }: { run: AgentRun }) {
  const navigate = useNavigate();
  const attach = useServerFn(attachRunToDossier);
  const [busyId, setBusyId] = useState<string | null>(null);

  const candidates = run.draft?.routing?.candidates ?? [];

  const handleAttach = async (dossierId: string) => {
    setBusyId(dossierId);
    try {
      await attach({ data: { run_id: run.id, dossier_id: dossierId } });
      toast.success("Demande rattachée au dossier.");
      void navigate({ to: "/dossiers/$id", params: { id: dossierId } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FolderOpen className="h-3.5 w-3.5 text-primary" />
        Plusieurs dossiers correspondent. Choisissez celui à rattacher.
      </div>

      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun candidat à proposer.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void handleAttach(c.id)}
                disabled={busyId !== null}
                className="group flex w-full items-start gap-2 rounded-xl border border-border/60 bg-background p-3 text-left transition hover:border-primary/40 hover:bg-accent/30 disabled:opacity-60"
              >
                <FolderOpen className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground group-hover:text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  {c.category ? (
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {c.category}
                    </p>
                  ) : null}
                </div>
                {busyId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button variant="outline" size="sm" onClick={() => void navigate({ to: "/dossiers" })}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Créer un nouveau dossier
      </Button>
    </div>
  );
}
