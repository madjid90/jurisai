import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import {
  searchLegalSources,
  renderLegalBasisBlock,
  type LegalSource,
} from "@/server/_shared/legal-rag.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";

export type WorkflowStep = {
  key: string;
  title: string;
  description?: string;
  type?: "action" | "document" | "decision" | "wait";
  kind?: string;
  template_slug?: string;
  legal_refs?: string[];
  delay_days?: number;
  requires_sourcing?: boolean;
};

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

// ─── Generate a document from a workflow step (template_slug + variables) ──

export const generateDocFromWorkflowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      instanceId: z.string().uuid(),
      stepIndex: z.number().int().min(0),
      stepKey: z.string().min(1),
      templateSlug: z.string().min(1),
      variables: z.record(z.string(), z.string()).default({}),
      autoComplete: z.boolean().default(true),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    // Load instance (RLS via tenant)
    const { data: inst, error: instErr } = await supabaseAdmin
      .from("workflow_instances")
      .select("id, tenant_id, definition_id, dossier_id, current_step_index, context, title")
      .eq("id", data.instanceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (instErr) throw new Error(instErr.message);
    if (!inst) throw new Error("Instance introuvable");

    // Load template
    const { data: tpl, error: tplErr } = await supabaseAdmin
      .from("document_templates")
      .select("id, name, body, variables, is_public, tenant_id")
      .eq("slug", data.templateSlug)
      .or(`is_public.eq.true,tenant_id.eq.${tenantId}`)
      .maybeSingle();
    if (tplErr) throw new Error(tplErr.message);
    if (!tpl) throw new Error(`Modèle « ${data.templateSlug} » introuvable`);

    // Merge variables: instance.context (string-coerced) ⊕ caller-provided (wins)
    const ctxVars: Record<string, string> = {};
    const ctx = ((inst as any).context ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(ctx)) {
      if (v != null && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
        ctxVars[k] = String(v);
      }
    }
    const merged: Record<string, string> = { ...ctxVars, ...data.variables };

    // Render {{var}} placeholders, leaving unknown ones visible as [var]
    const body = String((tpl as any).body ?? "");
    const rendered = body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
      const v = merged[key];
      return v != null && v !== "" ? v : `[${key}]`;
    });

    // Title
    const title = `${(tpl as any).name} – ${(inst as any).title ?? "Procédure"}`;

    // Create document
    const { data: doc, error: docErr } = await (supabaseAdmin as any)
      .from("documents")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        template_id: (tpl as any).id,
        title,
        content: rendered,
        variables: merged,
      })
      .select("id")
      .single();
    if (docErr || !doc) throw new Error(docErr?.message ?? "Échec création document");

    // Link via step_run + (optionally) advance the workflow
    if (data.autoComplete) {
      const { data: def } = await supabaseAdmin
        .from("workflow_definitions").select("steps").eq("id", (inst as any).definition_id).maybeSingle();
      const steps = (((def as any)?.steps ?? []) as WorkflowStep[]);

      await (supabaseAdmin as any).from("workflow_step_runs").insert({
        instance_id: data.instanceId,
        step_index: data.stepIndex,
        step_key: data.stepKey,
        status: "done",
        notes: `Document généré : ${title}`,
        output: { document_id: doc.id, template_slug: data.templateSlug },
        executed_by: userId,
        executed_at: new Date().toISOString(),
        generated_document_id: doc.id,
      });

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

      return { ok: true, documentId: doc.id as string, advanced: true, completed: isComplete };
    }

    return { ok: true, documentId: doc.id as string, advanced: false, completed: false };
  });

// ─── Get template variable schema by slug (for the form) ──────────────────

export const getTemplateBySlug = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ slug: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { data: row, error } = await supabaseAdmin
      .from("document_templates")
      .select("id, slug, name, description, variables, body, legal_basis")
      .eq("slug", data.slug)
      .or(`is_public.eq.true,tenant_id.eq.${tenantId}`)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Modèle introuvable");
    return row as any;
  });
