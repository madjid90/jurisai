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
import { fillTemplate as sharedFillTemplate } from "@/server/_shared/template";

export type WorkflowStep = {
  key: string;
  title: string;
  description?: string;
  type?: "action" | "document" | "decision" | "wait";
  kind?: string;
  template_slug?: string;
  legal_refs?: string[];
  delay_days?: number;
  reminder_days?: number;
  requires_sourcing?: boolean;
};

type WorkflowInstanceRow = {
  id: string;
  tenant_id: string;
  current_step_index: number | null;
  definition_id: string;
  dossier_id: string | null;
  client_id?: string | null;
  title: string;
  status?: string;
  context: Record<string, unknown> | null;
  workflow_definitions?: WorkflowDefinitionRow | null;
};

type WorkflowDefinitionRow = {
  id: string;
  title: string;
  steps: WorkflowStep[];
  requires_sourcing?: boolean | null;
};

type DocumentTemplateRow = {
  id: string;
  name: string;
  body: string | null;
  variables: unknown;
  is_public: boolean | null;
  tenant_id: string | null;
};

// ─── List workflow definitions (public + tenant) ───────────────────────────

export const listWorkflowDefinitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    // BUG-W1 : on filtre les workflows non finalisés (draft_ai, rejected, pending_human_review).
    // Seuls les workflows publiés ou validés (auto/humain) apparaissent dans le catalogue utilisateur.
    const { data, error } = await supabaseAdmin
      .from("workflow_definitions")
      .select("id, slug, title, description, category, status, lifecycle_status, version, steps, legal_refs, estimated_duration_days, tenant_id")
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .in("lifecycle_status", ["ai_validated_auto", "human_validated"])
      .order("title", { ascending: true });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []) as any[];
  });

// ─── List active instances for tenant ──────────────────────────────────────

export const listWorkflowInstances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ status: z.enum(["in_progress", "completed", "cancelled", "all"]).optional() }).parse(i ?? {}),
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

    if (data.dossierId) {
      try {
        await logTimelineEvent({
          tenantId,
          dossierId: data.dossierId,
          actorId: userId,
          eventType: "workflow.started",
          title: `Procédure démarrée : ${data.title}`,
          metadata: { workflow_instance_id: inserted.id, definition_id: data.definitionId },
        });
      } catch (e) { console.warn("[workflow] timeline log failed:", e); }
    }

    return { id: inserted.id as string };
  });

// Crée un rappel (reminders) pour l'étape `step` à partir d'aujourd'hui.
// `delay_days` ou `reminder_days` (priorité au + petit) déclenchent le rappel.
async function maybeCreateStepReminder(opts: {
  tenantId: string;
  userId: string;
  dossierId: string | null;
  instanceId: string;
  instanceTitle: string;
  step: WorkflowStep & { reminder_days?: number };
  stepIndex: number;
}) {
  const days = (() => {
    const candidates = [opts.step.delay_days, (opts.step as any).reminder_days].filter(
      (v): v is number => typeof v === "number" && v > 0,
    );
    return candidates.length ? Math.min(...candidates) : null;
  })();
  if (days == null) return;
  const remindAt = new Date(Date.now() + days * 86400_000).toISOString();
  try {
    await supabaseAdmin.from("reminders").insert({
      tenant_id: opts.tenantId,
      user_id: opts.userId,
      created_by: opts.userId,
      dossier_id: opts.dossierId,
      title: `Procédure « ${opts.instanceTitle} » — ${opts.step.title}`,
      body: opts.step.description ?? null,
      remind_at: remindAt,
      metadata: {
        source: "workflow",
        workflow_instance_id: opts.instanceId,
        step_index: opts.stepIndex,
        step_key: opts.step.key,
      },
    });
  } catch (e) {
    console.warn("[workflow] reminder insert failed:", e);
  }
}

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
      .select("id, tenant_id, current_step_index, definition_id, dossier_id, title")
      .eq("id", data.instanceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (instErr) throw new Error(instErr.message);
    if (!inst) throw new Error("Instance introuvable");

    const { data: def } = await supabaseAdmin
      .from("workflow_definitions").select("steps").eq("id", (inst as any).definition_id).maybeSingle();
    const steps = ((def as any)?.steps ?? []) as WorkflowStep[];
    const currentStep = steps[data.stepIndex];

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
    await supabaseAdmin
      .from("workflow_instances")
      .update({
        current_step_index: isComplete ? steps.length : nextIndex,
        status: isComplete ? "completed" : "in_progress",
        completed_at: isComplete ? new Date().toISOString() : null,
      })
      .eq("id", data.instanceId);

    const dossierId = (inst as any).dossier_id as string | null;
    const instTitle = (inst as any).title as string;

    // Timeline
    if (dossierId) {
      try {
        await logTimelineEvent({
          tenantId,
          dossierId,
          actorId: userId,
          eventType: isComplete ? "workflow.completed" : "workflow.advanced",
          title: isComplete
            ? `Procédure terminée : ${instTitle}`
            : `Étape « ${currentStep?.title ?? data.stepKey} » validée`,
          description: data.notes ?? null,
          metadata: {
            workflow_instance_id: data.instanceId,
            step_index: data.stepIndex,
            step_key: data.stepKey,
          },
        });
      } catch (e) { console.warn("[workflow] timeline log failed:", e); }
    }

    // Rappel automatique pour l'étape suivante
    if (!isComplete) {
      const nextStep = steps[nextIndex];
      if (nextStep) {
        await maybeCreateStepReminder({
          tenantId, userId, dossierId, instanceId: data.instanceId,
          instanceTitle: instTitle, step: nextStep, stepIndex: nextIndex,
        });
      }
    }

    return { ok: true, completed: isComplete };
  });

export const cancelWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ instanceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { data: inst } = await supabaseAdmin
      .from("workflow_instances")
      .select("dossier_id, title")
      .eq("id", data.instanceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("workflow_instances")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", data.instanceId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    if ((inst as any)?.dossier_id) {
      try {
        await logTimelineEvent({
          tenantId,
          dossierId: (inst as any).dossier_id,
          actorId: userId,
          eventType: "workflow.cancelled",
          title: `Procédure annulée : ${(inst as any).title}`,
          metadata: { workflow_instance_id: data.instanceId },
        });
      } catch (e) { console.warn("[workflow] timeline log failed:", e); }
    }
    return { ok: true };
  });

// ─── Helpers internes ─────────────────────────────────────────────────────

async function loadInstanceAndStep(
  tenantId: string,
  instanceId: string,
  stepIndex: number,
): Promise<{ inst: any; def: any; step: WorkflowStep }> {
  const { data: inst, error: instErr } = await supabaseAdmin
    .from("workflow_instances")
    .select("id, tenant_id, definition_id, dossier_id, current_step_index, context, title, workflow_definitions(id, title, steps, requires_sourcing)")
    .eq("id", instanceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (instErr) throw new Error(instErr.message);
  if (!inst) throw new Error("Instance introuvable");
  const def = (inst as any).workflow_definitions;
  const steps = ((def?.steps ?? []) as WorkflowStep[]);
  const step = steps[stepIndex];
  if (!step) throw new Error("Étape introuvable");
  return { inst, def, step };
}

function buildSourcingQuery(step: WorkflowStep, inst: any, def: any): string {
  const parts: string[] = [];
  if (step.title) parts.push(step.title);
  if (step.description) parts.push(step.description);
  if (Array.isArray(step.legal_refs) && step.legal_refs.length > 0) {
    parts.push(step.legal_refs.join(" "));
  }
  if (def?.title) parts.push(def.title);
  // Champs de contexte utiles (motif, client, type de contrat…)
  const ctx = (inst?.context ?? {}) as Record<string, unknown>;
  for (const k of ["motif", "type_contrat", "domaine", "secteur", "idcc"]) {
    if (typeof ctx[k] === "string" && (ctx[k] as string).length > 0) {
      parts.push(String(ctx[k]));
    }
  }
  return parts.join(" — ").slice(0, 500);
}

// ─── Sourcer une étape (RAG) ──────────────────────────────────────────────

export const sourceWorkflowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      instanceId: z.string().uuid(),
      stepIndex: z.number().int().min(0),
      query: z.string().trim().max(500).optional(),
      idcc: z.string().trim().max(20).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { inst, def, step } = await loadInstanceAndStep(tenantId, data.instanceId, data.stepIndex);

    const ctx = (inst.context ?? {}) as Record<string, unknown>;
    const idcc = data.idcc ?? (typeof ctx.idcc === "string" ? (ctx.idcc as string) : null);
    const query = data.query?.trim() || buildSourcingQuery(step, inst, def);

    const result = await searchLegalSources(query, { idcc, limit: 6 });

    return {
      ok: result.ok,
      reason: result.reason ?? null,
      query: result.query,
      sources: result.sources,
    };
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
      /** Sources légales sélectionnées par l'utilisateur (issues de sourceWorkflowStep). */
      legalSources: z
        .array(
          z.object({
            n: z.number().int(),
            chunk_id: z.string(),
            source_id: z.string(),
            title: z.string(),
            reference: z.string().nullable().optional(),
            url: z.string().nullable().optional(),
            source_type: z.string().nullable().optional(),
            heading: z.string().nullable().optional(),
            excerpt: z.string(),
            score: z.number(),
          }),
        )
        .default([]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    const { inst, def, step } = await loadInstanceAndStep(tenantId, data.instanceId, data.stepIndex);

    // Politique sourcing : si la def OU l'étape exige sourcing → ≥ 1 source obligatoire
    const requiresSourcing = Boolean(def?.requires_sourcing || step.requires_sourcing);
    if (requiresSourcing && data.legalSources.length === 0) {
      throw new Error(
        "Sources légales requises : utilisez « Sourcer cette étape » avant de générer le document.",
      );
    }

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
    const ctxData = ((inst as any).context ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(ctxData)) {
      if (v != null && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
        ctxVars[k] = String(v);
      }
    }
    const merged: Record<string, string> = { ...ctxVars, ...data.variables };

    // G5 — Render {{var}} placeholders via le helper partagé.
    const body = String((tpl as any).body ?? "");
    const rendered = sharedFillTemplate(body, merged, {
      onMissing: (key) => `[${key}]`,
    });

    // Append "Bases légales" block + footer marqueur citations
    const sources: LegalSource[] = data.legalSources.map((s) => ({
      n: s.n,
      chunk_id: s.chunk_id,
      source_id: s.source_id,
      title: s.title,
      reference: s.reference ?? null,
      url: s.url ?? null,
      source_type: s.source_type ?? null,
      heading: s.heading ?? null,
      excerpt: s.excerpt,
      score: s.score,
    }));
    const legalBlock = renderLegalBasisBlock(sources);
    const finalContent = `${rendered}${legalBlock}`;

    // Title
    const title = `${(tpl as any).name} – ${(inst as any).title ?? "Procédure"}`;

    // Create document
    const { data: doc, error: docErr } = await supabaseAdmin
      .from("documents")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        template_id: (tpl as any).id,
        title,
        content: finalContent,
        variables: merged,
      })
      .select("id")
      .single();
    if (docErr || !doc) throw new Error(docErr?.message ?? "Échec création document");

    // Timeline (dossier)
    if ((inst as any).dossier_id) {
      try {
        await logTimelineEvent({
          tenantId,
          dossierId: (inst as any).dossier_id,
          actorId: userId,
          eventType: "workflow.document_generated",
          title: `Document généré (étape « ${step.title} ») — ${sources.length} source${sources.length > 1 ? "s" : ""}`,
          metadata: {
            document_id: doc.id,
            template_slug: data.templateSlug,
            workflow_instance_id: data.instanceId,
            step_index: data.stepIndex,
            sources_count: sources.length,
            source_ids: sources.map((s) => s.source_id),
          },
        });
      } catch (e) {
        console.warn("[workflow] timeline log failed:", e);
      }
    }

    // Link via step_run + (optionally) advance the workflow
    if (data.autoComplete) {
      const steps = ((def?.steps ?? []) as WorkflowStep[]);

      // BUG-W3 : éviter d'insérer un second step_run "done" pour le même step_index.
      const { data: existingDone } = await supabaseAdmin
        .from("workflow_step_runs")
        .select("id")
        .eq("instance_id", data.instanceId)
        .eq("step_index", data.stepIndex)
        .eq("status", "done")
        .maybeSingle();
      if (existingDone) {
        return { ok: true, documentId: doc.id as string, advanced: false, completed: false, sources_used: sources.length, alreadyAdvanced: true };
      }

      await supabaseAdmin.from("workflow_step_runs").insert({
        instance_id: data.instanceId,
        step_index: data.stepIndex,
        step_key: data.stepKey,
        status: "done",
        notes: `Document généré : ${title}${sources.length ? ` · ${sources.length} source(s)` : ""}`,
        output: { document_id: doc.id, template_slug: data.templateSlug },
        executed_by: userId,
        executed_at: new Date().toISOString(),
        generated_document_id: doc.id,
        legal_sources: sources,
      });

      const nextIndex = data.stepIndex + 1;
      const isComplete = nextIndex >= steps.length;
      await supabaseAdmin
        .from("workflow_instances")
        .update({
          current_step_index: isComplete ? steps.length : nextIndex,
          status: isComplete ? "completed" : "in_progress",
          completed_at: isComplete ? new Date().toISOString() : null,
        })
        .eq("id", data.instanceId);

      // Rappel automatique pour l'étape suivante
      if (!isComplete) {
        const nextStep = steps[nextIndex];
        if (nextStep) {
          await maybeCreateStepReminder({
            tenantId,
            userId,
            dossierId: (inst as any).dossier_id ?? null,
            instanceId: data.instanceId,
            instanceTitle: (inst as any).title ?? "Procédure",
            step: nextStep,
            stepIndex: nextIndex,
          });
        }
      }

      return { ok: true, documentId: doc.id as string, advanced: true, completed: isComplete, sources_used: sources.length };
    }

    return { ok: true, documentId: doc.id as string, advanced: false, completed: false, sources_used: sources.length };
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
