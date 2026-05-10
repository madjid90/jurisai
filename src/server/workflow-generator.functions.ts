// Wrappers HTTP (createServerFn). Toute la logique est dans
// `workflow-generator-core.server.ts` — ce fichier ne doit contenir QUE des
// déclarations createServerFn pour que le splitter Vite isole proprement
// les imports serveur (supabaseAdmin, RAG, etc.) du bundle client.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "./_shared/tenant.server";
import { logWorkflowAudit } from "./_shared/workflow-audit.server";
import {
  runGenerateWorkflow,
  GenerateInput,
  type GenerateWorkflowResult,
} from "./workflow-generator-core.server";

export type { GenerateWorkflowResult } from "./workflow-generator-core.server";

export const generateWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GenerateInput.parse(i))
  .handler(async ({ data, context }): Promise<GenerateWorkflowResult> => {
    const { userId } = context as { userId: string };
    return runGenerateWorkflow(data, userId);
  });

export const setWorkflowLifecycleStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      definitionId: z.string().uuid(),
      status: z.enum(["human_validated", "rejected", "pending_human_review"]),
      reason: z.string().max(1000).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;

    const { data: roleCheck } = await sb.rpc("has_role", {
      _user_id: userId, _role: "admin", _tenant_id: tenantId,
    });
    const { data: superCheck } = await sb.rpc("is_super_admin", { _user_id: userId });
    if (!roleCheck && !superCheck) throw new Error("Réservé aux admins");

    const { data: before } = await sb
      .from("workflow_definitions")
      .select("id, lifecycle_status, tenant_id, title")
      .eq("id", data.definitionId)
      .maybeSingle();
    if (!before) throw new Error("Workflow introuvable");
    if (before.tenant_id && before.tenant_id !== tenantId && !superCheck) {
      throw new Error("Workflow d'un autre tenant");
    }

    const update: Record<string, unknown> = {
      lifecycle_status: data.status,
      validated_by: data.status === "human_validated" ? userId : null,
      validated_at: data.status === "human_validated" ? new Date().toISOString() : null,
      requires_human_review: data.status === "pending_human_review",
      rejected_reason: data.status === "rejected" ? (data.reason ?? null) : null,
    };
    const { error } = await sb.from("workflow_definitions").update(update).eq("id", data.definitionId);
    if (error) throw new Error(error.message);

    await logWorkflowAudit({
      tenantId,
      userId,
      workflowDefinitionId: data.definitionId,
      action:
        data.status === "human_validated" ? "workflow.human_validated" :
        data.status === "rejected"        ? "workflow.rejected" :
                                            "workflow.pending_review",
      beforeState: { lifecycle_status: before.lifecycle_status },
      afterState: { lifecycle_status: data.status },
      metadata: { reason: data.reason ?? null },
    });

    return { ok: true, lifecycle_status: data.status };
  });

export const listGenerationRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ limit: z.number().min(1).max(100).optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await supabaseAdmin
      .from("workflow_generation_runs")
      .select("id, prompt, domain, category, status, llm_model, cache_hit, tokens_used, duration_ms, scores, error_message, generated_definition_id, duplicate_of_definition_id, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 30);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (rows ?? []) as any[];
  });

export const getGenerationRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ runId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { data: run } = await sb
      .from("workflow_generation_runs")
      .select("*")
      .eq("id", data.runId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!run) throw new Error("Run introuvable");
    const { data: checks } = await sb
      .from("workflow_quality_checks")
      .select("*")
      .eq("generation_run_id", data.runId);
    const { data: definition } = run.generated_definition_id
      ? await sb.from("workflow_definitions").select("*").eq("id", run.generated_definition_id).maybeSingle()
      : { data: null };
    return { run, checks: checks ?? [], definition };
  });
