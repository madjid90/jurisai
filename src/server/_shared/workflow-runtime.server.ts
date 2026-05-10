// Runtime workflow pas-à-pas — helpers serveur partagés entre createServerFn
// et l'outil agent run_workflow_step.
//
// Logique : Comprendre → Sourcer → Proposer → Préparer → VALIDER → Exécuter → Archiver → Suivre.
// Pour chaque étape :
//   1. Charger l'instance + définition
//   2. Vérifier multi-tenant
//   3. Détecter actions sensibles (sensitive-actions catalog)
//   4. Si sensible & pas de validation_request_id → créer validation_requests + bloquer
//   5. Calculer due_at via legal-delays
//   6. Insérer workflow_step_run (status=in_progress|done)
//   7. Avancer current_step_index, marquer instance completed si dernière étape
//   8. Logger timeline + audit

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logTimelineEvent } from "./timeline.server";
import { logWorkflowAudit } from "./workflow-audit.server";
import { computeLegalDeadline, extractStepDelay, type DelayResult } from "./legal-delays.server";
import { detectSensitiveActions } from "./sensitive-actions.server";
import { WORKFLOW_VALIDATOR_ROLES } from "./workflow-roles.server";

// JSON-serializable types (TanStack server-fn impose des champs définis)
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type StepDef = {
  key?: string;
  title?: string;
  description?: string;
  type?: string;
  legal_refs?: Json[];
  delay_amount?: number;
  delay_unit?: string;
  delay_days?: number;
  duration_days?: number;
  requires_human_review?: boolean;
  [k: string]: Json | undefined;
};

export type WorkflowInstanceFull = {
  id: string;
  tenant_id: string;
  definition_id: string;
  dossier_id: string | null;
  client_id: string | null;
  title: string;
  status: string;
  current_step_index: number;
  context: { [k: string]: Json };
  steps: StepDef[];
  definition_title: string;
  total_steps: number;
  step_runs: Array<{
    id: string;
    step_index: number;
    step_key: string;
    status: string;
    due_at: string | null;
    notes: string | null;
    output: { [k: string]: Json } | null;
    requires_validation: boolean;
    validation_request_id: string | null;
    delay_calculation: { [k: string]: Json };
    executed_at: string | null;
  }>;
  current_step: StepDef | null;
};

export async function loadInstance(
  instanceId: string,
  tenantId: string,
): Promise<WorkflowInstanceFull> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data: inst, error } = await sb
    .from("workflow_instances")
    .select("id, tenant_id, definition_id, dossier_id, client_id, title, status, current_step_index, context")
    .eq("id", instanceId)
    .maybeSingle();
  if (error || !inst) throw new Error("Instance de workflow introuvable");
  if (inst.tenant_id !== tenantId) throw new Error("Workflow non accessible (tenant)");

  const { data: def } = await sb
    .from("workflow_definitions")
    .select("title, steps")
    .eq("id", inst.definition_id)
    .maybeSingle();
  const steps: StepDef[] = Array.isArray(def?.steps) ? (def.steps as StepDef[]) : [];

  const { data: runs } = await sb
    .from("workflow_step_runs")
    .select("id, step_index, step_key, status, due_at, notes, output, requires_validation, validation_request_id, delay_calculation, executed_at")
    .eq("instance_id", instanceId)
    .order("step_index", { ascending: true });

  const idx = inst.current_step_index ?? 0;
  return {
    ...inst,
    steps,
    definition_title: def?.title ?? inst.title,
    total_steps: steps.length,
    step_runs: runs ?? [],
    current_step: steps[idx] ?? null,
  };
}

export type ExecuteStepInput = {
  instanceId: string;
  stepIndex: number;
  notes?: string;
  output?: Record<string, unknown>;
  /** Si true, force l'exécution malgré les actions sensibles (validation déjà obtenue) */
  validationOverrideId?: string;
};

export type ExecuteStepResult = {
  step_run: {
    id: string;
    step_index: number;
    status: string;
    due_at: string | null;
    requires_validation: boolean;
    validation_request_id: string | null;
  };
  delay: DelayResult | null;
  blocked_for_validation: boolean;
  validation_request_id: string | null;
  workflow_completed: boolean;
  next_step: StepDef | null;
};

export async function executeStep(
  input: ExecuteStepInput,
  ctx: { userId: string; tenantId: string },
): Promise<ExecuteStepResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const inst = await loadInstance(input.instanceId, ctx.tenantId);

  if (input.stepIndex !== inst.current_step_index) {
    throw new Error(
      `L'étape ${input.stepIndex + 1} n'est pas l'étape courante (${inst.current_step_index + 1}).`,
    );
  }
  const stepDef = inst.steps[input.stepIndex];
  if (!stepDef) throw new Error("Étape introuvable dans la définition");

  // 1) Détection action sensible (catalogue)
  const detection = await detectSensitiveActions([
    {
      key: stepDef.key,
      title: stepDef.title,
      description: stepDef.description,
      kind: stepDef.type,
    },
  ]);
  const sensitive = {
    is_sensitive: detection.contains_sensitive,
    matched_patterns: detection.detected.map((d) => d.action_label),
    blocking: detection.blocking,
    detected: detection.detected,
  };
  const requiresValidation =
    sensitive.is_sensitive || stepDef.requires_human_review === true;

  let validationId: string | null = input.validationOverrideId ?? null;
  let blocked = false;

  if (requiresValidation && !validationId) {
    // Créer une demande de validation et bloquer
    const { data: admins } = await sb
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", ctx.tenantId)
      .in("role", [...WORKFLOW_VALIDATOR_ROLES])
      .limit(1);
    const assignedTo =
      (admins?.[0] as { user_id: string } | undefined)?.user_id ?? ctx.userId;

    const { data: vr, error: vrErr } = await sb
      .from("validation_requests")
      .insert({
        tenant_id: ctx.tenantId,
        dossier_id: inst.dossier_id,
        requested_by: ctx.userId,
        assigned_to: assignedTo,
        subject_type: `workflow_step:${stepDef.key ?? input.stepIndex}`,
        comment:
          sensitive.matched_patterns.length > 0
            ? `Étape sensible détectée : ${sensitive.matched_patterns.join(", ")}`
            : "Étape requérant une validation humaine",
        status: "pending",
      })
      .select("id")
      .single();
    if (vrErr) throw new Error(`Validation request: ${vrErr.message}`);
    validationId = vr.id;
    blocked = true;

    if (inst.dossier_id) {
      await logTimelineEvent({
        tenantId: ctx.tenantId,
        dossierId: inst.dossier_id,
        actorId: ctx.userId,
        eventType: "validation.requested",
        title: `Validation requise : ${stepDef.title ?? `étape ${input.stepIndex + 1}`}`,
        metadata: {
          source: "workflow_runtime",
          instance_id: inst.id,
          step_index: input.stepIndex,
          validation_id: validationId,
        },
      });
    }
  }

  // 2) Calcul du délai si défini sur l'étape
  let delay: DelayResult | null = null;
  let dueAt: string | null = null;
  const d = extractStepDelay(stepDef as Record<string, unknown>);
  if (d) {
    delay = computeLegalDeadline({
      startDate: new Date(),
      amount: d.amount,
      unit: d.unit,
    });
    dueAt = `${delay.dueDate}T23:59:59.000Z`;
  }

  // 3) Persistance step_run
  const status = blocked ? "pending" : "done";
  const { data: stepRun, error: srErr } = await sb
    .from("workflow_step_runs")
    .insert({
      instance_id: inst.id,
      step_index: input.stepIndex,
      step_key: stepDef.key ?? `step_${input.stepIndex}`,
      status,
      output: input.output ?? null,
      notes: input.notes ?? null,
      executed_by: ctx.userId,
      executed_at: blocked ? null : new Date().toISOString(),
      due_at: dueAt,
      delay_calculation: (delay as unknown as Record<string, unknown>) ?? {},
      requires_validation: requiresValidation,
      validation_request_id: validationId,
      step_definition: stepDef as Record<string, unknown>,
      legal_sources: Array.isArray(stepDef.legal_refs) ? stepDef.legal_refs : [],
    })
    .select("id, step_index, status, due_at, requires_validation, validation_request_id")
    .single();
  if (srErr) throw new Error(`Step run: ${srErr.message}`);

  // 4) Avancer si non bloqué
  let completed = false;
  let nextStep: StepDef | null = null;
  if (!blocked) {
    const newIndex = input.stepIndex + 1;
    completed = newIndex >= inst.total_steps;
    await sb
      .from("workflow_instances")
      .update({
        current_step_index: completed ? input.stepIndex : newIndex,
        status: completed ? "completed" : "in_progress",
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", inst.id);
    nextStep = completed ? null : (inst.steps[newIndex] ?? null);
  }

  // 5) Timeline + audit
  if (inst.dossier_id) {
    await logTimelineEvent({
      tenantId: ctx.tenantId,
      dossierId: inst.dossier_id,
      actorId: ctx.userId,
      eventType: blocked ? "workflow.step_blocked" : completed ? "workflow.completed" : "workflow.advanced",
      title: blocked
        ? `Étape bloquée (validation) : ${stepDef.title ?? input.stepIndex + 1}`
        : completed
          ? `Procédure terminée : ${inst.title}`
          : `Étape franchie : ${stepDef.title ?? input.stepIndex + 1}`,
      metadata: {
        source: "workflow_runtime",
        instance_id: inst.id,
        step_index: input.stepIndex,
        due_at: dueAt,
        delay,
      },
    });
  }
  await logWorkflowAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    workflowDefinitionId: inst.definition_id,
    workflowInstanceId: inst.id,
    action: blocked
      ? "workflow.sensitive_action_blocked"
      : completed
        ? "workflow.executed"
        : "workflow.step_completed",
    metadata: {
      step_index: input.stepIndex,
      step_key: stepDef.key,
      sensitive: sensitive.is_sensitive,
      matched_patterns: sensitive.matched_patterns,
      due_at: dueAt,
    },
  });

  return {
    step_run: stepRun,
    delay,
    blocked_for_validation: blocked,
    validation_request_id: validationId,
    workflow_completed: completed,
    next_step: nextStep,
  };
}

export async function skipStep(
  input: { instanceId: string; stepIndex: number; reason: string },
  ctx: { userId: string; tenantId: string },
): Promise<{ ok: true; next_step: StepDef | null; workflow_completed: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const inst = await loadInstance(input.instanceId, ctx.tenantId);
  if (input.stepIndex !== inst.current_step_index) {
    throw new Error("L'étape à passer n'est pas l'étape courante.");
  }
  const stepDef = inst.steps[input.stepIndex];
  if (!stepDef) throw new Error("Étape introuvable");

  await sb.from("workflow_step_runs").insert({
    instance_id: inst.id,
    step_index: input.stepIndex,
    step_key: stepDef.key ?? `step_${input.stepIndex}`,
    status: "skipped",
    notes: input.reason,
    executed_by: ctx.userId,
    executed_at: new Date().toISOString(),
    step_definition: stepDef as Record<string, unknown>,
    legal_sources: [],
  });

  const newIndex = input.stepIndex + 1;
  const completed = newIndex >= inst.total_steps;
  await sb
    .from("workflow_instances")
    .update({
      current_step_index: completed ? input.stepIndex : newIndex,
      status: completed ? "completed" : "in_progress",
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq("id", inst.id);

  if (inst.dossier_id) {
    await logTimelineEvent({
      tenantId: ctx.tenantId,
      dossierId: inst.dossier_id,
      actorId: ctx.userId,
      eventType: "workflow.step_skipped",
      title: `Étape ignorée : ${stepDef.title ?? input.stepIndex + 1}`,
      description: input.reason,
      metadata: { source: "workflow_runtime", instance_id: inst.id, step_index: input.stepIndex },
    });
  }
  await logWorkflowAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    workflowDefinitionId: inst.definition_id,
    workflowInstanceId: inst.id,
    action: "workflow.step_skipped",
    metadata: { step_index: input.stepIndex, reason: input.reason },
  });

  return {
    ok: true,
    next_step: completed ? null : (inst.steps[newIndex] ?? null),
    workflow_completed: completed,
  };
}
