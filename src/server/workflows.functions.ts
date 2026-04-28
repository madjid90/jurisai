import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ProfileRow = { tenant_id: string | null };

export type WorkflowStep = {
  key: string;
  title: string;
  description?: string;
  type?: "action" | "document" | "decision" | "wait";
  legal_refs?: string[];
  delay_days?: number;
};

async function getTenantId(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  const tenantId = (data as ProfileRow | null)?.tenant_id;
  if (!tenantId) throw new Error("Aucun tenant rattaché à votre compte.");
  return tenantId;
}

// ─── List workflow definitions (public + tenant) ───────────────────────────

export const listWorkflowDefinitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { data, error } = await supabaseAdmin
      .from("workflow_definitions")
      .select("id, slug, title, description, category, status, version, steps, legal_refs, estimated_duration_days, tenant_id")
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .order("title", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  });

// ─── List active instances for tenant ──────────────────────────────────────

export const listWorkflowInstances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ status: z.enum(["active", "completed", "cancelled", "all"]).optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    let q = supabaseAdmin
      .from("workflow_instances")
      .select("id, title, status, current_step_index, definition_id, dossier_id, client_id, started_by, created_at, completed_at, context")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as any[];
  });

// ─── Get one instance with definition + step runs ──────────────────────────

export const getWorkflowInstance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ instanceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { data: inst, error } = await supabaseAdmin
      .from("workflow_instances")
      .select("*, workflow_definitions(*)")
      .eq("id", data.instanceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inst) throw new Error("Instance introuvable");
    const { data: runs } = await supabaseAdmin
      .from("workflow_step_runs")
      .select("*")
      .eq("instance_id", data.instanceId)
      .order("step_index", { ascending: true });
    return { instance: inst as any, runs: (runs ?? []) as any[] };
  });

// ─── Start a new instance ──────────────────────────────────────────────────

export const startWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      definitionId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      dossierId: z.string().uuid().nullable().optional(),
      clientId: z.string().uuid().nullable().optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { data: inserted, error } = await (supabaseAdmin as any)
      .from("workflow_instances")
      .insert({
        tenant_id: tenantId,
        definition_id: data.definitionId,
        title: data.title,
        dossier_id: data.dossierId ?? null,
        client_id: data.clientId ?? null,
        started_by: userId,
        context: data.context ?? {},
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id as string };
  });

// ─── Mark a step as completed and advance ──────────────────────────────────

export const completeWorkflowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      instanceId: z.string().uuid(),
      stepIndex: z.number().int().min(0),
      stepKey: z.string().min(1),
      notes: z.string().max(2000).optional(),
      output: z.record(z.string(), z.unknown()).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    const { data: inst, error: instErr } = await supabaseAdmin
      .from("workflow_instances")
      .select("id, tenant_id, current_step_index, definition_id")
      .eq("id", data.instanceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (instErr) throw new Error(instErr.message);
    if (!inst) throw new Error("Instance introuvable");

    const { data: def } = await supabaseAdmin
      .from("workflow_definitions").select("steps").eq("id", (inst as any).definition_id).maybeSingle();
    const steps = ((def as any)?.steps ?? []) as WorkflowStep[];

    // Insert step run
    await (supabaseAdmin as any).from("workflow_step_runs").insert({
      instance_id: data.instanceId,
      step_index: data.stepIndex,
      step_key: data.stepKey,
      status: "done",
      notes: data.notes ?? null,
      output: data.output ?? null,
      executed_by: userId,
      executed_at: new Date().toISOString(),
    });

    // Advance instance
    const nextIndex = data.stepIndex + 1;
    const isComplete = nextIndex >= steps.length;
    await (supabaseAdmin as any)
      .from("workflow_instances")
      .update({
        current_step_index: isComplete ? steps.length : nextIndex,
        status: isComplete ? "completed" : "active",
        completed_at: isComplete ? new Date().toISOString() : null,
      })
      .eq("id", data.instanceId);

    return { ok: true, completed: isComplete };
  });

export const cancelWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ instanceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { error } = await (supabaseAdmin as any)
      .from("workflow_instances")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", data.instanceId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
