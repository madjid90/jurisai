// RefusedView — l'agent a refusé de répondre (sources insuffisantes,
// hors scope, prompt bloqué…). On affiche la raison et des suggestions.

import { ShieldAlert } from "lucide-react";
import type { AgentRun } from "../ResultRenderer";

export function RefusedView({ run }: { run: AgentRun }) {
  const reason = run.refusal_reason ?? "L'agent n'a pas pu répondre à cette demande.";

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-medium text-destructive">Réponse refusée</p>
          <p className="mt-1 text-sm text-foreground/80">{reason}</p>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Suggestions :
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Précisez votre situation (contexte, secteur, pièces jointes).</li>
          <li>Joignez le document concerné pour qu'il soit analysé.</li>
          <li>Reformulez la question avec des termes juridiques explicites.</li>
        </ul>
      </div>
    </div>
  );
}
