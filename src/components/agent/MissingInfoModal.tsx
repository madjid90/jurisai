import { useMemo, useState } from "react";
import { HelpCircle, Sparkles } from "lucide-react";
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
  /** Questions libres remontées par l'agent (en plus des champs structurés). */
  freeformQuestions: string[];
  onSubmit: (enriched: string) => void;
};

/**
 * Modale "informations manquantes" — câblée sur les règles métier.
 * Combine champs structurés (BusinessRule.required_fields) + questions libres de l'agent.
 */
export function MissingInfoModal({
  open,
  onOpenChange,
  rule,
  freeformQuestions,
  onSubmit,
}: Props) {
  const [structured, setStructured] = useState<Record<string, string>>({});
  const [freeform, setFreeform] = useState<Record<number, string>>({});

  const totalRequired = rule.required_fields.length + freeformQuestions.length;
  const filled = useMemo(() => {
    const a = Object.values(structured).filter((v) => v.trim()).length;
    const b = Object.values(freeform).filter((v) => v.trim()).length;
    return a + b;
  }, [structured, freeform]);

  function submit() {
    const lines: string[] = [];
    rule.required_fields.forEach((f) => {
      const v = (structured[f.key] ?? "").trim();
      if (v) lines.push(`- ${f.label} : ${v}`);
    });
    freeformQuestions.forEach((q, i) => {
      const v = (freeform[i] ?? "").trim();
      if (v) lines.push(`- ${q} → ${v}`);
    });
    if (lines.length === 0) return;
    onSubmit(`Informations complémentaires (${rule.title}) :\n${lines.join("\n")}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-amber-500" />
            {rule.title} — informations manquantes
          </DialogTitle>
          {rule.subtitle && (
            <DialogDescription>{rule.subtitle}</DialogDescription>
          )}
        </DialogHeader>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {rule.required_fields.map((f) => (
            <div key={f.key}>
              <label className="block text-[13px] font-medium text-foreground">
                {f.label}
              </label>
              {f.type === "textarea" ? (
                <textarea
                  rows={3}
                  value={structured[f.key] ?? ""}
                  onChange={(e) =>
                    setStructured((p) => ({ ...p, [f.key]: e.target.value }))
                  }
                  placeholder={f.placeholder}
                  className="input-base mt-1 resize-none"
                />
              ) : (
                <input
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  value={structured[f.key] ?? ""}
                  onChange={(e) =>
                    setStructured((p) => ({ ...p, [f.key]: e.target.value }))
                  }
                  placeholder={f.placeholder}
                  className="input-base mt-1"
                />
              )}
              {f.hint && (
                <p className="mt-1 text-[11px] text-muted-foreground">{f.hint}</p>
              )}
            </div>
          ))}

          {freeformQuestions.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Précisions demandées par l'agent
              </p>
              {freeformQuestions.map((q, i) => (
                <div key={i}>
                  <label className="block text-[13px] font-medium text-foreground">
                    {q}
                  </label>
                  <input
                    value={freeform[i] ?? ""}
                    onChange={(e) =>
                      setFreeform((p) => ({ ...p, [i]: e.target.value }))
                    }
                    className="input-base mt-1"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            {filled}/{totalRequired} renseigné(s)
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={filled === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Relancer avec ces infos
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
