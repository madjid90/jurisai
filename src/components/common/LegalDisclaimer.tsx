// Disclaimer juridique universel. À afficher :
//   - En footer de toute réponse de l'agent
//   - En footer permanent de la landing publique
//   - Dans les pages publiques de génération de documents
//
// Conformité : mention obligatoire ne se substituant pas à un avocat (art. 54 loi 1971).

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type LegalDisclaimerProps = {
  variant?: "compact" | "expanded";
  className?: string;
};

export function LegalDisclaimer({ variant = "compact", className }: LegalDisclaimerProps) {
  if (variant === "expanded") {
    return (
      <aside
        role="note"
        className={cn(
          "rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-900",
          className,
        )}
      >
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" aria-hidden="true" />
          <p>
            <strong>Information juridique</strong> — JurisAI fournit une assistance documentaire et
            opérationnelle automatisée. Ses réponses ne constituent <strong>pas un conseil juridique</strong>{" "}
            au sens de l'article 54 de la loi du 31 décembre 1971 et ne se substituent pas à la
            consultation d'un avocat. Pour toute décision engageant votre responsabilité juridique,
            consultez un professionnel du droit.
          </p>
        </div>
      </aside>
    );
  }

  // compact
  return (
    <p
      role="note"
      className={cn(
        "flex items-center justify-center gap-1.5 text-center text-[11px] leading-tight text-muted-foreground",
        className,
      )}
    >
      <Info className="h-3 w-3" aria-hidden="true" />
      <span>
        Assistance documentaire automatisée — ne se substitue pas à un avocat.
      </span>
    </p>
  );
}
