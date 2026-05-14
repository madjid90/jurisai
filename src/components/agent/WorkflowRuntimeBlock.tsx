// WorkflowRuntimeBlock — composant partagé : charge l'état d'une instance de
// workflow (étape courante, validations en attente) et rend l'UI pas-à-pas
// (WorkflowStatusBanner + WorkflowStepInline).
//
// Réutilisé par /agent, /chat (via WorkflowView) et /mes-demandes/$id pour que
// l'utilisateur puisse exécuter sa procédure depuis n'importe où — pas
// uniquement la page /workflows_/$id.

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { loadWorkflowInstanceState as getWorkflowInstance } from "@/lib/server-fns/workflow-runtime.functions";
import { WorkflowStatusBanner } from "./WorkflowStatusBanner";
import { WorkflowStepInline } from "./WorkflowStepInline";

export type WorkflowRuntimeBlockProps = {
  instanceId: string;
  onAdvanced?: () => void | Promise<void>;
  className?: string;
};

export function WorkflowRuntimeBlock({
  instanceId,
  onAdvanced,
  className,
}: WorkflowRuntimeBlockProps) {
  const getInstance = useServerFn(getWorkflowInstance);
  const [instance, setInstance] = useState<Record<string, unknown> | null>(null);

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
  const currentStep = instance.current_step as
    | {
        title?: string;
        description?: string;
        legal_refs?: unknown[];
        requires_human_review?: boolean;
      }
    | null;
  const stepIndex = (instance.current_step_index as number) ?? 0;
  const totalSteps = (instance.total_steps as number) ?? 0;
  const stepRuns =
    (instance.step_runs as Array<{ requires_validation: boolean; status: string }>) ?? [];
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

  return (
    <div className={["space-y-3", className].filter(Boolean).join(" ")}>
      <WorkflowStatusBanner
        status={bannerStatus}
        validationRequired={blocked || sensitive}
        executionBlocked={blocked}
      />
      <div className="text-xs text-muted-foreground">
        Procédure :{" "}
        <span className="font-medium text-foreground">
          {instance.definition_title as string}
        </span>
        {" · "}
        Étape {Math.min(stepIndex + 1, totalSteps)} / {totalSteps}
      </div>
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
    </div>
  );
}
