import { useState } from "react";
import { Send, ShieldCheck, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROLE_LABEL, type BusinessRule } from "@/lib/agent/business-rules";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule: BusinessRule;
  /** Soumet la demande de validation : onSubmit({ roles, message, sla_days }). */
  onSubmit: (payload: { roles: string[]; message: string; sla_days: number }) => void | Promise<void>;
};

/**
 * Modale "Validation humaine" — affichée pour les actions sensibles
 * (licenciement, contentieux, transaction, RGPD…). Pré-câble les destinataires
 * et le SLA d'après la règle métier.
 */
export function HumanValidationModal({
  open,
  onOpenChange,
  rule,
  onSubmit,
}: Props) {
  const [roles, setRoles] = useState<string[]>(rule.validation_roles);
  const [message, setMessage] = useState("");
  const [slaDays, setSlaDays] = useState(rule.validation_sla_days ?? 2);
  const [submitting, setSubmitting] = useState(false);

  function toggleRole(r: string) {
    setRoles((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));
  }

  async function submit() {
    if (roles.length === 0) return;
    setSubmitting(true);
    try {
      await onSubmit({ roles, message, sla_days: slaDays });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" />
            Demande de validation — {rule.title}
          </DialogTitle>
          <DialogDescription>
            Cette action est sensible. Sélectionnez les profils habilités à valider avant exécution.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              Destinataires
            </p>
            <div className="flex flex-wrap gap-2">
              {(["juriste", "rh_manager", "dirigeant", "daf", "dpo"] as const).map((r) => {
                const active = roles.includes(r);
                const recommended = rule.validation_roles.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRole(r)}
                    className={`rounded-full border px-3 py-1 text-[12px] font-medium transition ${
                      active
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border bg-background/50 text-foreground hover:bg-secondary/50"
                    }`}
                  >
                    {ROLE_LABEL[r]}
                    {recommended && !active && (
                      <span className="ml-1 text-[10px] text-amber-600">recommandé</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-foreground">
              Message (contexte, urgence, pièces jointes…)
            </label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Précisez le contexte pour faciliter la décision."
              className="input-base mt-1 resize-none"
            />
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-foreground">
              Délai souhaité (jours)
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={slaDays}
              onChange={(e) => setSlaDays(Math.max(1, Number(e.target.value) || 1))}
              className="input-base mt-1 w-28"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-foreground hover:bg-secondary/50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || roles.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Envoyer la demande
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
