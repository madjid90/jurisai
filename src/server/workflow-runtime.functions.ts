// Server functions runtime workflow — appelables depuis l'UI chat / dossier.
// Toutes les opérations passent par les helpers _shared/workflow-runtime.server.ts
// pour garantir : multi-tenant, audit, timeline, calcul délais FR, sensitivité.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getTenantId } from "./_shared/tenant.server";
import {
  loadInstance,
  executeStep,
  skipStep,
  type WorkflowInstanceFull,
  type ExecuteStepResult,
} from "./_shared/workflow-runtime.server";
import { computeLegalDeadline, type DelayUnit } from "./_shared/legal-delays.server";

export const getWorkflowInstance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ instance_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<WorkflowInstanceFull> => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);
    return loadInstance(data.instance_id, tenantId);
  });

export const runWorkflowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        instance_id: z.string().uuid(),
        step_index: z.number().int().min(0),
        notes: z.string().max(2000).optional(),
        output: z.record(z.string(), z.unknown()).optional(),
        validation_override_id: z.string().uuid().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ExecuteStepResult> => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);
    return executeStep(
      {
        instanceId: data.instance_id,
        stepIndex: data.step_index,
        notes: data.notes,
        output: data.output,
        validationOverrideId: data.validation_override_id,
      },
      { userId, tenantId },
    );
  });

export const skipWorkflowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        instance_id: z.string().uuid(),
        step_index: z.number().int().min(0),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);
    return skipStep(
      { instanceId: data.instance_id, stepIndex: data.step_index, reason: data.reason },
      { userId, tenantId },
    );
  });

/**
 * Calcul ad-hoc d'un délai légal FR (utilisable depuis l'UI ou un autre serveur).
 */
export const computeDeadline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        start_date: z.string(),
        amount: z.number().int().min(1).max(3650),
        unit: z.enum(["calendar_days", "business_days", "working_days", "months", "weeks"]),
        roll_forward: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    return computeLegalDeadline({
      startDate: data.start_date,
      amount: data.amount,
      unit: data.unit as DelayUnit,
      rollForward: data.roll_forward,
    });
  });
