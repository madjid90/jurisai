import { AlertTriangle, CheckCircle2, ListChecks, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BusinessRule } from "@/lib/agent/business-rules";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule: BusinessRule;
  /** Action : "confirme" la procédure → callback. */
  onConfirm: () => void;
  /** Cancel → permet de revenir / éditer. */
  onCancel?: () => void;
};

/**
 * Modale "Confirmation" — affichée avant de lancer la procédure.
 * Affiche risques juridiques + étapes prévues, issus de la règle métier.
 */
export function ConfirmationModal({
  open,
  onOpenChange,
  rule,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-orange-500" />
            Confirmer : {rule.title}
          </DialogTitle>
          {rule.subtitle && (
            <DialogDescription>{rule.subtitle}</DialogDescription>
          )}
        </DialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {rule.risks.length > 0 && (
            <section className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Risques juridiques majeurs
              </p>
              <ul className="space-y-1.5 text-[13px] text-foreground">
                {rule.risks.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-orange-600">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {rule.steps.length > 0 && (
            <section className="rounded-xl border border-border bg-background/40 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" />
                Étapes prévues ({rule.steps.length})
              </p>
              <ol className="space-y-1.5 text-[13px] text-foreground">
                {rule.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}.
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <p className="rounded-lg bg-secondary/40 p-2.5 text-[12px] text-muted-foreground">
            En confirmant, JurisAI prépare les documents, programme les rappels et trace l'événement
            dans la timeline du dossier. Aucune notification externe n'est envoyée sans validation
            humaine supplémentaire.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
            className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-foreground hover:bg-secondary/50"
          >
            Modifier
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-95"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Confirmer et préparer
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
