import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { AgentRunOutput } from "@/server/agent.functions";
import { createAgentValidationRequest } from "@/server/agent-validations.functions";
import { pickRule } from "@/lib/agent/business-rules";
import { MissingInfoModal } from "./MissingInfoModal";
import { ConfirmationModal } from "./ConfirmationModal";
import { HumanValidationModal } from "./HumanValidationModal";

const INTENT_LABEL: Record<string, string> = {
  question_juridique: "Question juridique",
  redaction_document: "Rédaction",
  analyse_document: "Analyse",
  gestion_dossier: "Gestion de dossier",
  suivi_echeance: "Échéance",
  conformite: "Conformité",
  veille: "Veille",
  recherche_jurisprudence: "Jurisprudence",
  chiffrage: "Chiffrage",
  reclamation: "Réclamation",
  autre: "Autre",
};

const DOMAIN_LABEL: Record<string, string> = {
  rh: "RH / Social",
  commercial: "Commercial",
  societes: "Sociétés",
  rgpd: "RGPD",
  fiscal: "Fiscal",
  contentieux: "Contentieux",
  administratif: "Administratif",
  reglementation_metier: "Réglementation métier",
  general: "Général",
};

type Props = {
  result: AgentRunOutput;
  /** Callback pour relancer l'agent avec un message enrichi (missing info / action). */
  onRelaunch?: (message: string) => void;
  onClose?: () => void;
};

/**
 * Carte résultat agent — version inline pour la home.
 * Sobre par défaut, dépliable pour la trace (mode avancé).
 */
export function AgentResultCard({ result, onRelaunch, onClose }: Props) {
  const [showTrace, setShowTrace] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const createValidation = useServerFn(createAgentValidationRequest);

  const rule = useMemo(() => pickRule(result), [result]);
  const hasMissing = result.missing_information.length > 0 || rule.required_fields.length > 0;
  const hasSensitive = result.requires_validation || rule.kind !== "generic";

  async function submitValidation(payload: { roles: string[]; message: string; sla_days: number }) {
    try {
      await createValidation({
        data: {
          action_type: rule.title,
          rule_kind: rule.kind,
          roles: payload.roles,
          message: payload.message,
          sla_days: payload.sla_days,
          agent_run_id: result.run_id,
        },
      });
      toast.success("Demande de validation envoyée");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-card/80 p-5 shadow-[var(--shadow-card)]">
      {/* En-tête : intention + fermer */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent">
            <Sparkles className="h-3 w-3" />
            {INTENT_LABEL[result.intent] ?? result.intent}
          </span>
          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-foreground">
            {DOMAIN_LABEL[result.domain] ?? result.domain}
          </span>
          {result.topic && (
            <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
              {result.topic}
            </span>
          )}
          {result.requires_validation && (
            <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase text-orange-600">
              Validation requise
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      {/* Refus motivé */}
      {result.refused && result.refusal_reason && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-700 dark:text-amber-400">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{result.refusal_reason}</span>
        </div>
      )}

      {/* Réponse */}
      {result.answer && !result.refused && (
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
          {result.answer}
        </div>
      )}

      {/* Barre d'actions métier */}
      {(hasMissing || hasSensitive || rule.steps.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/40 p-2.5">
          {hasMissing && onRelaunch && (
            <button
              type="button"
              onClick={() => setMissingOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[12.5px] font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              Compléter les informations
            </button>
          )}
          {rule.steps.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:opacity-95"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Préparer : {rule.title}
            </button>
          )}
          {hasSensitive && (
            <button
              type="button"
              onClick={() => setValidationOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 text-[12.5px] font-semibold text-accent hover:bg-accent-soft/80"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Demander validation
            </button>
          )}
        </div>
      )}


      {/* Actions suggérées */}
      {result.suggested_actions.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Target className="h-3 w-3" /> Actions suggérées
          </p>
          <div className="flex flex-wrap gap-2">
            {result.suggested_actions.map((a, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onRelaunch?.(a.label)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-secondary/60"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sources (compact) */}
      {result.sources.length > 0 && (
        <details className="group rounded-xl border border-border bg-background/40 p-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            {result.sources.length} source{result.sources.length > 1 ? "s" : ""} citée
            {result.sources.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-3 space-y-1.5 text-[12.5px]">
            {result.sources.map((s) => (
              <li key={s.n} className="border-l-2 border-accent pl-2">
                <span className="rounded border border-border px-1 py-0.5 font-mono text-[10px]">
                  [{s.n}]
                </span>{" "}
                <span className="font-medium text-foreground">{s.title}</span>
                {s.ref && <span className="text-muted-foreground"> · {s.ref}</span>}
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 inline-flex items-center text-accent hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Trace (mode avancé) */}
      {result.trace.length > 0 && (
        <button
          type="button"
          onClick={() => setShowTrace((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Wrench className="h-3 w-3" />
          {showTrace ? "Masquer" : "Voir"} la trace ({result.trace.length} outils)
        </button>
      )}
      {showTrace && result.trace.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-border bg-background/40 p-3 text-[11.5px]">
          {result.trace.map((t, i) => (
            <li key={i} className="flex items-center gap-2">
              {t.succeeded ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : (
                <AlertCircle className="h-3 w-3 text-destructive" />
              )}
              <code className="font-mono text-[11px]">{t.tool}</code>
              {t.sensitive && (
                <span className="rounded bg-orange-500/10 px-1 text-[9.5px] font-semibold uppercase text-orange-600">
                  sensible
                </span>
              )}
              {t.validation_request_id && (
                <span className="text-muted-foreground">→ validation créée</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Footer audit */}
      <p className="text-[10.5px] text-muted-foreground">
        Trace conservée ·{" "}
        <Link to="/admin/audit" className="text-accent hover:underline">
          journal d'audit
        </Link>
      </p>
    </section>
  );
}

/* ---------- Missing info form ---------- */

function MissingInfoForm({
  items,
  onSubmit,
}: {
  items: string[];
  onSubmit: (enriched: string) => void;
}) {
  const [values, setValues] = useState<Record<number, string>>({});
  const filled = Object.values(values).filter((v) => v.trim()).length;

  function relaunch() {
    const lines = items
      .map((q, i) => {
        const v = (values[i] ?? "").trim();
        return v ? `- ${q} → ${v}` : null;
      })
      .filter(Boolean);
    if (lines.length === 0) return;
    onSubmit(`Informations complémentaires :\n${lines.join("\n")}`);
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-amber-700 dark:text-amber-400">
        <HelpCircle className="h-3.5 w-3.5" />
        Pour aller plus loin, précisez :
      </p>
      <div className="space-y-2.5">
        {items.map((q, i) => (
          <div key={i}>
            <label className="block text-[12.5px] font-medium text-foreground">
              {q}
            </label>
            <input
              value={values[i] ?? ""}
              onChange={(e) =>
                setValues((p) => ({ ...p, [i]: e.target.value }))
              }
              placeholder="Votre réponse…"
              className="input-base mt-1"
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {filled}/{items.length} renseigné(s)
        </span>
        <button
          type="button"
          onClick={relaunch}
          disabled={filled === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Relancer avec ces infos
        </button>
      </div>
    </div>
  );
}
