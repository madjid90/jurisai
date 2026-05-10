// SmartDisclaimer — disclaimer juridique contextualisé (V3 §21).
// Affiche un avertissement adapté au statut de validation du workflow + au
// niveau de sévérité des actions sensibles détectées.

import { AlertTriangle, ShieldCheck, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type SmartDisclaimerStatus =
  | "human_validated"
  | "ai_validated_auto"
  | "pending_human_review"
  | "draft_ai"
  | "blocked";

export type SmartDisclaimerProps = {
  status: SmartDisclaimerStatus;
  maxSeverity?: "none" | "low" | "medium" | "high" | "critical";
  sensitiveCount?: number;
  className?: string;
  compact?: boolean;
};

type Variant = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  tone: "ok" | "info" | "warn" | "danger";
};

function variantFor(status: SmartDisclaimerStatus, severity: SmartDisclaimerProps["maxSeverity"]): Variant {
  if (status === "blocked" || severity === "critical") {
    return {
      icon: ShieldAlert,
      title: "Action sensible — validation humaine OBLIGATOIRE",
      body:
        "Cette procédure embarque au moins une action critique (licenciement, rupture, contentieux, RGPD majeur). Elle ne peut PAS être exécutée sans validation par un juriste ou avocat habilité. JurisAI bloque l'exécution tant que la validation n'est pas enregistrée.",
      tone: "danger",
    };
  }
  if (status === "human_validated") {
    return {
      icon: ShieldCheck,
      title: "Procédure validée par un juriste",
      body:
        "Cette procédure a été revue et validée par un humain habilité. Vous pouvez l'exécuter en confiance. JurisAI reste un assistant : la responsabilité finale de l'action reste de votre ressort.",
      tone: "ok",
    };
  }
  if (status === "ai_validated_auto") {
    return {
      icon: ShieldCheck,
      title: "Auto-validée par triple contrôle IA",
      body:
        "Cette procédure a passé : (1) RE-RAG sur sources légales, (2) consensus de 3 modèles IA indépendants, (3) détection actions sensibles. Aucune action critique détectée. Pour les enjeux majeurs, une revue par un avocat reste recommandée.",
      tone: "info",
    };
  }
  if (status === "pending_human_review") {
    return {
      icon: AlertTriangle,
      title: "Revue humaine recommandée",
      body:
        severity === "high"
          ? "Cette procédure contient des actions à risque élevé. Elle est utilisable comme guide, mais une validation par un juriste est fortement recommandée avant exécution."
          : "Score qualité IA insuffisant pour une auto-validation. Vérifiez chaque étape avant de l'utiliser.",
      tone: "warn",
    };
  }
  // draft_ai
  return {
    icon: Info,
    title: "Brouillon IA — vérification approfondie nécessaire",
    body:
      "Cette procédure est un brouillon généré par IA dont la qualité automatique est faible. Ne pas l'utiliser tel quel pour une procédure réelle ; faites valider chaque étape.",
    tone: "warn",
  };
}

const TONE_STYLES: Record<Variant["tone"], string> = {
  ok: "border-emerald-500/30 bg-emerald-500/5 text-emerald-900 dark:text-emerald-100",
  info: "border-sky-500/30 bg-sky-500/5 text-sky-900 dark:text-sky-100",
  warn: "border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-100",
  danger: "border-destructive/40 bg-destructive/5 text-destructive",
};

export function SmartDisclaimer({
  status,
  maxSeverity = "none",
  sensitiveCount = 0,
  className,
  compact = false,
}: SmartDisclaimerProps) {
  const v = variantFor(status, maxSeverity);
  const Icon = v.icon;

  return (
    <div
      role="note"
      className={cn(
        "rounded-xl border p-3 text-[13px] leading-snug",
        TONE_STYLES[v.tone],
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{v.title}</p>
          {!compact && <p className="mt-1 text-[12.5px] opacity-90">{v.body}</p>}
          {sensitiveCount > 0 && (
            <p className="mt-1 text-[11.5px] opacity-75">
              {sensitiveCount} action{sensitiveCount > 1 ? "s" : ""} sensible
              {sensitiveCount > 1 ? "s" : ""} détectée{sensitiveCount > 1 ? "s" : ""}.
              Sévérité max : <strong>{maxSeverity}</strong>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
