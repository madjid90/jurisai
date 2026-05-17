// Tour produit guidé en 3 étapes — déclenché la première fois que l'utilisateur
// arrive sur le dashboard après l'onboarding.
//
// Persistence : user_metadata.product_tour_completed_at (Supabase auth)
// → pas de migration nécessaire.
//
// Skippable à tout moment. Pas de spotlight DOM (trop fragile entre routes),
// juste une carte explicative en bas-droite avec navigation entre étapes.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, X, Check, MessageSquare, FolderPlus, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/AuthProvider";
import { markProductTourComplete } from "@/server/onboarding.functions";
import { cn } from "@/lib/utils";

type Step = {
  icon: typeof MessageSquare;
  title: string;
  description: string;
  cta: { label: string; to: string };
};

const STEPS: Step[] = [
  {
    icon: MessageSquare,
    title: "Posez votre première question",
    description:
      "L'agent IA répond à vos questions juridiques en s'appuyant sur les sources officielles (Code du travail, JO, conventions collectives). Essayez par exemple : « Quelle est la procédure pour licencier un salarié en CDI pour cause réelle et sérieuse ? »",
    cta: { label: "Ouvrir le chat", to: "/chat" },
  },
  {
    icon: FolderPlus,
    title: "Créez votre premier dossier",
    description:
      "Regroupez vos demandes, documents, échéances et risques par client ou par sujet. L'agent y accède pour vous donner des réponses contextualisées.",
    cta: { label: "Aller aux dossiers", to: "/dossiers" },
  },
  {
    icon: SettingsIcon,
    title: "Renseignez votre convention collective",
    description:
      "Saisissez votre code IDCC dans les paramètres pour que JurisAI adapte ses réponses à votre convention. C'est ce qui fait la différence entre une réponse générique et une réponse vraiment utile.",
    cta: { label: "Aller aux paramètres", to: "/settings" },
  },
];

export function ProductTour() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const markComplete = useServerFn(markProductTourComplete);
  const [stepIdx, setStepIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!user) return;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const completed = meta.product_tour_completed_at;
    if (!completed) {
      // Petit délai pour laisser le dashboard se charger
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
  }, [user]);

  if (!visible) return null;

  const step = STEPS[stepIdx];
  const Icon = step.icon;
  const isLast = stepIdx === STEPS.length - 1;

  const finish = async (opts?: { skipped?: boolean }) => {
    if (finishing) return;
    setFinishing(true);
    try {
      await markComplete();
    } catch {
      // best-effort, on continue
    }
    setVisible(false);
    setFinishing(false);
    if (!opts?.skipped && step.cta.to) {
      navigate({ to: step.cta.to });
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 w-full max-w-sm">
      <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-elevated)]">
        <div className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Étape {stepIdx + 1} / {STEPS.length}
            </p>
            <h3 className="mt-0.5 text-[15px] font-semibold text-foreground">{step.title}</h3>
          </div>
          <button
            type="button"
            onClick={() => finish({ skipped: true })}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="Passer le tour"
            disabled={finishing}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="px-5 py-4 text-[13px] leading-relaxed text-foreground/80">{step.description}</p>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 pb-3">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === stepIdx ? "w-6 bg-primary" : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
          <button
            type="button"
            onClick={() => finish({ skipped: true })}
            className="text-[12.5px] text-muted-foreground transition hover:text-foreground"
            disabled={finishing}
          >
            Passer le tour
          </button>
          <div className="flex items-center gap-2">
            {stepIdx > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                disabled={finishing}
              >
                Précédent
              </Button>
            )}
            {!isLast ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}
                disabled={finishing}
                className="bg-gradient-to-br from-primary to-accent text-primary-foreground"
              >
                Suivant
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => finish()}
                disabled={finishing}
                className="bg-gradient-to-br from-primary to-accent text-primary-foreground"
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                Terminer
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Link discret vers le CTA de l'étape, sans forcer la nav */}
      <div className="mt-2 text-center">
        <Link
          to={step.cta.to}
          className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {step.cta.label} →
        </Link>
      </div>
    </div>
  );
}
