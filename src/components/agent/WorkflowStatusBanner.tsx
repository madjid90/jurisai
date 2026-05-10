import { ShieldCheck, AlertTriangle, Sparkles, ShieldAlert, Clock } from "lucide-react";

type Props = {
  status?: string | null;
  riskLevel?: string | null;
  validationRequired?: boolean;
  executionBlocked?: boolean;
  sources_count?: number;
  quality_score?: number;
};

export function WorkflowStatusBanner({
  status,
  riskLevel,
  validationRequired,
  executionBlocked,
  sources_count,
  quality_score,
}: Props) {
  if (status === "human_validated") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40">
        <div className="flex items-start gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-medium text-emerald-900 dark:text-emerald-100">
              Procédure validée
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-300">
              Vérifiée par un juriste compétent. Vous pouvez l'utiliser en confiance.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "ai_validated_auto") {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/40">
        <div className="flex items-start gap-2">
          <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <div>
            <p className="font-medium text-blue-900 dark:text-blue-100">
              Procédure préparée par l'IA
              {typeof quality_score === "number" ? ` · Score ${quality_score}/100` : ""}
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Sources juridiques : {sources_count ?? "?"} · Contrôles automatiques OK.
              Vérification recommandée pour les étapes sensibles avant action officielle.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "draft_ai") {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/40">
        <div className="flex items-start gap-2">
          <Sparkles className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          <div>
            <p className="font-medium text-yellow-900 dark:text-yellow-100">
              Brouillon IA
              {typeof quality_score === "number" ? ` · Score ${quality_score}/100` : ""}
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              Workflow généré automatiquement.
              <strong> À vérifier avant toute action officielle ou sensible.</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "pending_human_review" || status === "needs_review") {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950/40">
        <div className="flex items-start gap-2">
          <Clock className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          <div>
            <p className="font-medium text-orange-900 dark:text-orange-100">
              Vérification humaine requise
            </p>
            <p className="text-sm text-orange-700 dark:text-orange-300">
              Score qualité moyen ou actions sensibles détectées. Une validation humaine est
              nécessaire avant exécution.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (executionBlocked || (validationRequired && riskLevel === "critical")) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/40">
        <div className="flex items-start gap-2">
          <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
          <div>
            <p className="font-medium text-red-900 dark:text-red-100">
              Validation humaine obligatoire
            </p>
            <p className="text-sm text-red-700 dark:text-red-300">
              Cette procédure contient des actions sensibles
              {riskLevel ? ` (${riskLevel})` : ""}. Je peux préparer le dossier et les
              documents, mais une validation humaine compétente est requise avant toute action
              officielle.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (validationRequired) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-100">
              Validation recommandée
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Étapes sensibles détectées — vérification humaine conseillée.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
