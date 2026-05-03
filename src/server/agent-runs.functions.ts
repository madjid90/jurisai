// Server functions de base pour la "boîte aux lettres" de l'agent (agent_runs).
// Étape 1 du plan async : créer une demande, la lire, lister les demandes courantes.
// Le moteur d'exécution (worker) viendra dans une étape suivante.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "./_shared/tenant.server";
import { classifyIntent, type AgentCtx } from "./_shared/agent-tools.server";
import { logTimelineEvent } from "./_shared/timeline.server";

const STATUSES = [
  "pending",
  "running",
  "waiting_info",
  "waiting_validation",
  "ready",
  "executed",
  "archived",
  "failed",
] as const;
export type AgentRunStatus = (typeof STATUSES)[number];

const CreateInput = z.object({
  message: z.string().min(1).max(8000),
  dossier_id: z.string().uuid().nullable().optional(),
  title: z.string().max(200).optional(),
  attachments: z
    .array(z.object({ analysis_id: z.string().uuid().optional(), filename: z.string().optional() }))
    .optional(),
});

/**
 * Crée une nouvelle demande à l'agent. Réponse immédiate (status=pending).
 * Le worker prendra le relais en asynchrone (étape suivante).
 */
export const createAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const draft = {
      attachments: data.attachments ?? [],
      questions: [] as unknown[],
      form: null as unknown,
      validation: null as unknown,
      analysis: null as unknown,
      procedure: null as unknown,
      sources: [] as unknown[],
    };

    const { data: row, error } = await supabaseAdmin
      .from("agent_runs")
      .insert({
        user_id: userId,
        tenant_id: tenantId,
        dossier_id: data.dossier_id ?? null,
        message: data.message,
        title: data.title ?? data.message.slice(0, 80),
        status: "pending",
        draft,
      } as never)
      .select("id, status, created_at")
      .single();

    if (error) throw new Error(error.message);
    return row;
  });

/** Récupère une demande (RLS limite au tenant). */
export const getAgentRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const { data: row, error } = await supabaseAdmin
      .from("agent_runs")
      .select("*")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("Demande introuvable");
    return row;
  });

const ListInput = z.object({
  status: z.enum(STATUSES).optional(),
  scope: z.enum(["mine", "tenant"]).default("mine"),
  limit: z.number().int().min(1).max(100).default(50),
});

/** Liste les demandes (par défaut : les miennes, toutes statuts). */
export const listMyRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    let q = supabaseAdmin
      .from("agent_runs")
      .select(
        "id, title, message, status, intent, domain, dossier_id, created_at, updated_at, executed_at, archived_at"
      )
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(data.limit);

    if (data.scope === "mine") q = q.eq("user_id", userId);
    if (data.status) q = q.eq("status", data.status);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------------------------------------------------------------------------
// MOTEUR (worker) — fait avancer une demande dans la machine à états.
// Étape 2 : Comprendre. Si requires_form / missing_information / requires_validation
// → status passe à waiting_info / waiting_validation. Sinon → ready.
// (La génération RAG + documents finaux viendra à l'étape suivante.)
// ---------------------------------------------------------------------------

type DraftShape = {
  attachments?: unknown[];
  classification?: unknown;
  questions?: unknown[];
  form?: unknown;
  validation?: unknown;
  analysis?: unknown;
  procedure?: unknown;
  sources?: unknown[];
  [k: string]: unknown;
};

export const processAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    // 1. Lock optimiste : pending|waiting_info → running
    const { data: run, error: loadErr } = await supabaseAdmin
      .from("agent_runs")
      .select("*")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!run) throw new Error("Demande introuvable");
    if (!["pending", "waiting_info"].includes((run as { status: string }).status)) {
      return { status: (run as { status: string }).status, skipped: true };
    }

    await supabaseAdmin
      .from("agent_runs")
      .update({ status: "running" } as never)
      .eq("id", data.id);

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      await supabaseAdmin
        .from("agent_runs")
        .update({ status: "failed", error_message: "LOVABLE_API_KEY manquant" } as never)
        .eq("id", data.id);
      throw new Error("LOVABLE_API_KEY manquant côté serveur");
    }

    try {
      const message = (run as { message: string }).message;
      const ctx: AgentCtx = { userId, tenantId, idcc: null, apiKey, sources: [] };

      // 2. Comprendre
      const classification = await classifyIntent(message, ctx);

      const draft = ((run as { draft: DraftShape }).draft ?? {}) as DraftShape;
      draft.classification = classification;
      draft.questions = classification.missing_information ?? [];

      // 3. Décider du prochain état
      let nextStatus: AgentRunStatus;
      if (
        classification.requires_form ||
        (Array.isArray(classification.missing_information) &&
          classification.missing_information.length > 0)
      ) {
        nextStatus = "waiting_info";
      } else if (classification.requires_validation) {
        nextStatus = "waiting_validation";
      } else {
        nextStatus = "ready";
      }

      await supabaseAdmin
        .from("agent_runs")
        .update({
          status: nextStatus,
          intent: classification.intent,
          domain: classification.domain,
          topic: classification.topic,
          confidence: classification.confidence,
          requires_rag: classification.requires_rag,
          requires_form: classification.requires_form,
          requires_validation: classification.requires_validation,
          requires_document_upload: classification.requires_document_upload,
          missing_information: classification.missing_information ?? [],
          suggested_actions: classification.suggested_actions ?? [],
          draft,
        } as never)
        .eq("id", data.id);

      // 4. Timeline si rattaché à un dossier
      const dossierId = (run as { dossier_id: string | null }).dossier_id;
      if (dossierId) {
        await logTimelineEvent({
          tenantId,
          dossierId,
          actorId: userId,
          eventType: "agent.run.advanced",
          title: `Agent : ${classification.intent} (${nextStatus})`,
          metadata: { run_id: data.id, status: nextStatus },
        });
      }

      return { status: nextStatus, run_id: data.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      await supabaseAdmin
        .from("agent_runs")
        .update({ status: "failed", error_message: msg } as never)
        .eq("id", data.id);
      throw err;
    }
  });

// ---------------------------------------------------------------------------
// Répondre aux questions de l'agent (formulaire dynamique).
// L'utilisateur fournit les infos manquantes → run repasse en pending pour
// que processAgentRun le relance.
// ---------------------------------------------------------------------------
export const answerAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        answers: z.record(z.string(), z.unknown()),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const { data: run, error } = await supabaseAdmin
      .from("agent_runs")
      .select("draft, status")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) throw new Error("Demande introuvable");
    if ((run as { status: string }).status !== "waiting_info") {
      throw new Error("La demande n'attend pas d'informations supplémentaires");
    }

    const draft = ((run as { draft: DraftShape }).draft ?? {}) as DraftShape;
    draft.form = { ...((draft.form as Record<string, unknown>) ?? {}), ...data.answers };

    await supabaseAdmin
      .from("agent_runs")
      .update({ status: "pending", draft } as never)
      .eq("id", data.id);

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Valider une demande sensible (passage waiting_validation → ready).
// ---------------------------------------------------------------------------
export const validateAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        approved: z.boolean(),
        comment: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const { data: run, error } = await supabaseAdmin
      .from("agent_runs")
      .select("status, draft, dossier_id")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) throw new Error("Demande introuvable");
    if ((run as { status: string }).status !== "waiting_validation") {
      throw new Error("La demande n'est pas en attente de validation");
    }

    const draft = ((run as { draft: DraftShape }).draft ?? {}) as DraftShape;
    draft.validation = {
      approved: data.approved,
      comment: data.comment ?? null,
      validated_by: userId,
      validated_at: new Date().toISOString(),
    };

    await supabaseAdmin
      .from("agent_runs")
      .update({
        status: data.approved ? "ready" : "archived",
        draft,
        archived_at: data.approved ? null : new Date().toISOString(),
      } as never)
      .eq("id", data.id);

    const dossierId = (run as { dossier_id: string | null }).dossier_id;
    if (dossierId) {
      await logTimelineEvent({
        tenantId,
        dossierId,
        actorId: userId,
        eventType: data.approved ? "agent.run.validated" : "agent.run.rejected",
        title: data.approved ? "Demande validée" : "Demande refusée",
        metadata: { run_id: data.id, comment: data.comment ?? null },
      });
    }

    return { ok: true, approved: data.approved };
  });

// ---------------------------------------------------------------------------
// Archiver une demande (manuellement).
// ---------------------------------------------------------------------------
export const archiveAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const { error } = await supabaseAdmin
      .from("agent_runs")
      .update({ status: "archived", archived_at: new Date().toISOString() } as never)
      .eq("id", data.id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
