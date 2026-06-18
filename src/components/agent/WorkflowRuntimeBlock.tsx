// WorkflowRuntimeBlock — vue simplifiée orientée client final (Sprint A UX).
//
// Refonte du 18/06 suite à retour utilisateur : le client PME ne doit PAS voir
// "Étape 2/6 — Convocation à entretien préalable" + jargon juridique. Il doit voir :
//   1. Titre simple + status visuel (⏳/✅/🛡️)
//   2. CHECKLIST récapitulative des étapes (✅ Fait / ⏳ En cours / ☐ À venir)
//   3. Bloc étape courante avec form (si waiting_info) ou message d'attente
//   4. Toggle "Voir les détails techniques" → ancien rendu avec sources/articles
//
// Réutilisé par /agent, /chat (via WorkflowView) et /mes-demandes/$id.

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, CheckCircle2, Circle, Clock, ShieldAlert, Loader2 } from "lucide-react";
import { loadWorkflowInstanceState as getWorkflowInstance } from "@/server/workflow-runtime.functions";
import { WorkflowStatusBanner } from "./WorkflowStatusBanner";
import { WorkflowStepInline } from "./WorkflowStepInline";

export type WorkflowRuntimeBlockProps = {
  instanceId: string;
  onAdvanced?: () => void | Promise<void>;
  className?: string;
};

type StepDef = {
  title?: string;
  description?: string;
  legal_refs?: unknown[];
  requires_human_review?: boolean;
};

type StepRun = {
  step_index: number;
  status: string;
  requires_validation: boolean;
  executed_at: string | null;
};

/**
 * Pour chaque étape, détermine son état visuel :
 *   "done"     → terminée (executed_at OK)
 *   "pending"  → en attente d'une validation humaine
 *   "current"  → étape courante en cours
 *   "todo"     → pas encore commencée
 */
function getStepState(
  idx: number,
  currentIdx: number,
  stepRuns: StepRun[],
): "done" | "pending" | "current" | "todo" {
  const run = stepRuns.find((r) => r.step_index === idx);
  if (run?.executed_at) return "done";
  if (run?.status === "pending" && run.requires_validation) return "pending";
  if (idx === currentIdx) return "current";
  if (idx < currentIdx) return "done"; // fallback : étape passée sans run = considérée faite
  return "todo";
}

function StepCheckbox({
  state,
  title,
  index,
  total,
}: {
  state: "done" | "pending" | "current" | "todo";
  title: string;
  index: number;
  total: number;
}) {
  const icon =
    state === "done" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
    ) : state === "pending" ? (
      <ShieldAlert className="h-4 w-4 text-amber-600 flex-shrink-0" />
    ) : state === "current" ? (
      <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
    ) : (
      <Circle className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
    );

  const text =
    state === "done"
      ? "text-foreground/70 line-through decoration-emerald-600/40"
      : state === "current"
        ? "text-foreground font-medium"
        : state === "pending"
          ? "text-amber-700 font-medium"
          : "text-muted-foreground";

  const badge =
    state === "pending" ? (
      <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
        Validation requise
      </span>
    ) : state === "current" ? (
      <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
        En cours
      </span>
    ) : null;

  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="text-[11px] tabular-nums text-muted-foreground/60 w-6">
        {index + 1}/{total}
      </span>
      {icon}
      <span className={`text-sm leading-snug ${text}`}>{title}</span>
      {badge}
    </li>
  );
}

export function WorkflowRuntimeBlock({
  instanceId,
  onAdvanced,
  className,
}: WorkflowRuntimeBlockProps) {
  const getInstance = useServerFn(getWorkflowInstance);
  const [instance, setInstance] = useState<Record<string, unknown> | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const load = async () => {
    try {
      const r = (await getInstance({ data: { instance_id: instanceId } })) as Record<
        string,
        unknown
      >;
      setInstance(r);
    } catch (e) {
      console.error("[WorkflowRuntimeBlock] load failed", e);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  if (!instance) return null;

  const status = instance.status as string;
  const definitionTitle = (instance.definition_title as string) ?? "Procédure";
  const stepIndex = (instance.current_step_index as number) ?? 0;
  const totalSteps = (instance.total_steps as number) ?? 0;
  const steps = (instance.steps as StepDef[]) ?? [];
  const stepRuns = (instance.step_runs as StepRun[]) ?? [];
  const currentStep = instance.current_step as StepDef | null;

  const blocked = stepRuns.some((r) => r.requires_validation && r.status === "pending");
  const sensitive = currentStep?.requires_human_review === true;

  const bannerStatus =
    status === "completed"
      ? "human_validated"
      : blocked
        ? "pending_human_review"
        : sensitive
          ? "draft_ai"
          : "ai_validated_auto";

  // Status humain simple pour le client
  const simpleStatus: { icon: React.ReactNode; label: string; tone: string } =
    status === "completed"
      ? { icon: <CheckCircle2 className="h-4 w-4" />, label: "Procédure terminée", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" }
      : blocked
        ? { icon: <ShieldAlert className="h-4 w-4" />, label: "Validation requise pour continuer", tone: "bg-amber-50 text-amber-700 border-amber-200" }
        : { icon: <Clock className="h-4 w-4" />, label: `Étape ${Math.min(stepIndex + 1, totalSteps)} sur ${totalSteps}`, tone: "bg-primary/5 text-primary border-primary/20" };

  return (
    <div className={["space-y-4", className].filter(Boolean).join(" ")}>
      {/* ─── En-tête simple : titre + status ─── */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">
            {definitionTitle}
          </h3>
          <div
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${simpleStatus.tone}`}
          >
            {simpleStatus.icon}
            <span>{simpleStatus.label}</span>
          </div>
        </div>
      </div>

      {/* ─── Checklist récap des étapes (visible client) ─── */}
      {steps.length > 0 ? (
        <div className="rounded-lg border border-border/60 bg-card/40 p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Aperçu de la procédure
          </p>
          <ul className="space-y-0">
            {steps.map((s, i) => (
              <StepCheckbox
                key={i}
                state={getStepState(i, stepIndex, stepRuns)}
                title={s.title ?? `Étape ${i + 1}`}
                index={i}
                total={steps.length}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {/* ─── Étape courante : form / action / message ─── */}
      {status !== "completed" && currentStep ? (
        <WorkflowStepInline
          instanceId={instanceId}
          stepIndex={stepIndex}
          title={currentStep.title ?? `Étape ${stepIndex + 1}`}
          description={currentStep.description ?? null}
          legalRefs={
            (currentStep.legal_refs as Array<{
              code?: string;
              article?: string;
              label?: string;
            }>) ?? []
          }
          onAdvanced={async () => {
            await load();
            await onAdvanced?.();
          }}
        />
      ) : null}

      {/* ─── Toggle détails techniques (pour juriste/admin) ─── */}
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
      >
        {showDetails ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        {showDetails ? "Masquer les détails techniques" : "Voir les détails techniques (sources, articles)"}
      </button>

      {showDetails ? (
        <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
          <WorkflowStatusBanner
            status={bannerStatus}
            validationRequired={blocked || sensitive}
            executionBlocked={blocked}
          />
          <div className="text-xs text-muted-foreground">
            Procédure :{" "}
            <span className="font-medium text-foreground">{definitionTitle}</span>
            {" · "}
            Étape {Math.min(stepIndex + 1, totalSteps)} / {totalSteps}
            {" · "}
            Instance ID :{" "}
            <code className="rounded bg-background px-1 text-[10px]">{instanceId.slice(0, 8)}…</code>
          </div>
          {steps.length > 0 ? (
            <div className="space-y-2">
              {steps.map((s, i) => {
                const refs = (s.legal_refs as Array<{
                  code?: string;
                  article?: string;
                  label?: string;
                }>) ?? [];
                if (refs.length === 0) return null;
                return (
                  <div key={i} className="rounded-md bg-background/60 p-2 text-xs">
                    <p className="font-medium text-foreground">
                      Étape {i + 1} — {s.title}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Références :{" "}
                      {refs.map((r, j) => (
                        <span key={j} className="mr-2">
                          {r.code ?? ""} {r.article ?? ""}
                          {r.label ? ` (${r.label})` : ""}
                          {j < refs.length - 1 ? "," : ""}
                        </span>
                      ))}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
