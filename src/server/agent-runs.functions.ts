// Server functions de base pour la "boîte aux lettres" de l'agent (agent_runs).
// Étape 1 du plan async : créer une demande, la lire, lister les demandes courantes.
// Le moteur d'exécution (worker) viendra dans une étape suivante.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import { captureServerError } from "@/server/_shared/error-monitor.server";
import { runLegalReasoning } from "@/server/_shared/legal-reasoning.server";
import { buildLegalProcedure } from "@/server/_shared/procedure-builder.server";
import {
  buildWorkflowFromProcedure,
  buildDocumentsFromProcedure,
  linkWorkflowToSources,
  blockSensitiveActionUntilValidation,
} from "@/server/_shared/agent360-builders.server";
import { classifyIntent, safeParseJSON, searchDossier, type AgentCtx } from "@/server/_shared/agent-tools.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";
import { searchLegalSources } from "@/server/_shared/legal-rag.server";
import { runIntentActions } from "@/server/_shared/agent-intent-actions.server";
// llmFetch n'est plus nécessaire ici — l'appel IA passe par runAgentLoop
import { sanitizePromptInput, PROMPT_INJECTION_GUARD } from "@/server/_shared/prompt-sanitizer.server";
import { runAgentLoop } from "@/server/_shared/agent-loop.server";
import { AGENT_TOOLS, AGENT_SYSTEM_PROMPT } from "@/server/_shared/agent-tools-config.server";

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
  parent_run_id: z.string().uuid().nullable().optional(),
  attachments: z
    .array(z.object({ analysis_id: z.string().uuid().optional(), filename: z.string().optional() }))
    .optional(),
});

/**
 * Décision de routage métier renvoyée immédiatement à l'UI.
 * L'Agent 360 décide où ouvrir l'utilisateur après création de la demande.
 */
export type AgentRouting =
  | { target: "dossier"; route: string; dossier_id: string; title?: string }
  | {
      target: "dossier_selection";
      candidates: Array<{ id: string; title: string; category: string | null }>;
      route: string;
    }
  | { target: "analysis"; route: string; analysis_id: string }
  | { target: "agent"; route: string; mode: "document" | "procedure" | "chat" }
  | { target: "chat"; route: string; run_id: string }
  | { target: "requests"; route: string; run_id: string };

/**
 * Implémente `resolveAgentDestination()` (spec produit § 7).
 * Décide où afficher l'utilisateur après création d'une demande.
 *
 * Règles :
 *  - Document joint            → /analyses/:id
 *  - question_juridique         → /chat (Assistant juridique sourcé)
 *  - redaction_document         → /agent?mode=document
 *  - conformite / procédure     → /agent?mode=procedure
 *  - gestion_dossier            → /dossiers/:id (1 fiable) ou choix inline
 *  - suivi_echeance / autre     → /mes-demandes (boîte de réception)
 */
async function decideRouting(
  ctx: AgentCtx,
  runId: string,
  message: string,
  attachments: Array<{ analysis_id?: string; filename?: string }>,
): Promise<AgentRouting> {
  // 1. Document joint → analyse directe.
  const firstAnalysis = attachments.find((a) => !!a.analysis_id);
  if (firstAnalysis?.analysis_id) {
    return {
      target: "analysis",
      route: `/analyses/${firstAnalysis.analysis_id}`,
      analysis_id: firstAnalysis.analysis_id,
    };
  }

  // 2. Classification rapide pour orienter.
  let intent = "autre";
  try {
    const c = await classifyIntent(message, ctx);
    intent = c.intent;
  } catch {
    /* fallback */
  }

  // 3. Recherche de dossier (intent explicite ou mots-clés).
  if (intent === "gestion_dossier" || /\bdossier\b|\bclient\b/i.test(message)) {
    try {
      const r = await searchDossier({ query: message, limit: 5 }, ctx);
      const dossiers = ((r.result as { dossiers?: Array<{ id: string; title: string; category: string | null }> })
        ?.dossiers ?? []) as Array<{ id: string; title: string; category: string | null }>;
      if (dossiers.length === 1) {
        return {
          target: "dossier",
          route: `/dossiers/${dossiers[0].id}`,
          dossier_id: dossiers[0].id,
          title: dossiers[0].title,
        };
      }
      if (dossiers.length > 1) {
        return {
          target: "dossier_selection",
          candidates: dossiers,
          route: `/agent?run=${runId}&mode=dossier_selection`,
        };
      }
      // Aucun dossier trouvé → tomber dans /mes-demandes (pas /agent).
    } catch {
      /* ignore */
    }
  }

  // 4. Question juridique pure → Assistant /chat (RAG sourcé).
  if (intent === "question_juridique" || intent === "recherche_jurisprudence" || intent === "veille") {
    return { target: "chat", route: `/chat?run=${runId}`, run_id: runId };
  }

  // 5. Génération de document.
  if (intent === "redaction_document") {
    return { target: "agent", route: `/agent?run=${runId}&mode=document`, mode: "document" };
  }

  // 6. Procédure / conformité.
  if (intent === "conformite" || /procédure|procedure|workflow/i.test(message)) {
    return { target: "agent", route: `/agent?run=${runId}&mode=procedure`, mode: "procedure" };
  }

  // 7. Par défaut (suivi, réclamation, autre…) → boîte de réception.
  return { target: "requests", route: `/mes-demandes?run=${runId}`, run_id: runId };
}

/**
 * Crée une nouvelle demande à l'agent. Réponse immédiate (status=pending).
 * Renvoie aussi la décision de routage pour que l'UI ouvre directement la bonne page.
 */
export const createAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    // Rate limit sur createAgentRun (10/min/user).
    // Audit fix : fail-OPEN si la RPC ne répond pas (permission, réseau, etc.).
    // Avant : fail-CLOSED bloquait TOUT createAgentRun si Lovable n'a pas le bon service_role.
    // La protection rate-limit est utile mais pas critique au point de bloquer le produit.
    const { data: rl, error: rlErr } = await supabaseAdmin.rpc("check_rate_limit", {
      p_user_id: userId,
      p_endpoint: "create-agent-run",
      p_max_per_minute: 10,
    });
    if (rlErr) {
      // Log structuré au lieu de throw, on continue (fail-open).
      console.warn("[createAgentRun] Rate limit check unavailable, allowing:", rlErr.message);
    } else if (Array.isArray(rl) && rl[0] && !rl[0].allowed) {
      throw new Error("Trop de demandes (10/min). Réessayez dans une minute.");
    }

    const draft = {
      attachments: data.attachments ?? [],
      questions: [] as unknown[],
      form: null as unknown,
      validation: null as unknown,
      analysis: null as unknown,
      procedure: null as unknown,
      sources: [] as unknown[],
      routing: null as AgentRouting | null,
    };

    // Si la question est un suivi (parent_run_id), on hérite automatiquement
    // du dossier_id du parent pour que le fil reste cohérent dans le 360°.
    let inheritedDossierId: string | null = data.dossier_id ?? null;
    if (data.parent_run_id && !inheritedDossierId) {
      const { data: parent } = await supabaseAdmin
        .from("agent_runs")
        .select("dossier_id, tenant_id")
        .eq("id", data.parent_run_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (parent) inheritedDossierId = (parent as { dossier_id: string | null }).dossier_id ?? null;
    }

    // Audit fix : INSERT via RPC SECURITY DEFINER pour bypass RLS proprement.
    // Avant : INSERT direct échouait avec "new row violates row-level security policy"
    // dès que supabaseAdmin n'utilisait pas le vrai service_role (cas Lovable Cloud).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { data: rpcRows, error } = await sb.rpc("insert_agent_run", {
      _user_id: userId,
      _tenant_id: tenantId,
      _message: data.message,
      _title: data.title ?? data.message.slice(0, 80),
      _dossier_id: inheritedDossierId,
      _parent_run_id: data.parent_run_id ?? null,
      _draft: draft,
      _status: "pending",
    });

    if (error) throw new Error(error.message);
    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!row?.id) throw new Error("Création run échouée — RPC n'a pas retourné d'ID");

    // Décision de routage : l'Agent 360 oriente vers la bonne page métier.
    let routing: AgentRouting;
    try {
      const apiKey = LLM_API_KEY ?? "";
      // Récupérer l'IDCC du tenant pour le routage
      const { data: tenantForRouting } = await supabaseAdmin
        .from("tenants")
        .select("idcc")
        .eq("id", tenantId)
        .maybeSingle();
      const routingIdcc = (tenantForRouting as { idcc: string | null } | null)?.idcc ?? null;
      const ctx: AgentCtx = { userId, tenantId, idcc: routingIdcc, apiKey, sources: [] };
      routing = await decideRouting(
        ctx,
        (row as { id: string }).id,
        data.message,
        data.attachments ?? [],
      );
    } catch {
      routing = {
        target: "agent",
        route: `/agent?run=${(row as { id: string }).id}`,
        mode: "chat",
      };
    }

    // Persiste le routing dans le draft pour que l'UI puisse retrouver les
    // candidats (dossier_selection) lors du rechargement de la page.
    try {
      await supabaseAdmin
        .from("agent_runs")
        .update({ draft: { ...draft, routing } } as never)
        .eq("id", (row as { id: string }).id);
    } catch {
      /* non bloquant */
    }

    return { ...(row as { id: string; status: string; created_at: string }), routing };
  });

/**
 * Rattache une run à un dossier choisi par l'utilisateur (cas dossier_selection).
 * Logge un événement timeline dans le dossier cible.
 */
export const attachRunToDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ run_id: z.string().uuid(), dossier_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const { data: run, error: errRun } = await supabaseAdmin
      .from("agent_runs")
      .select("id, message, title, tenant_id")
      .eq("id", data.run_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (errRun) throw new Error(errRun.message);
    if (!run) throw new Error("Demande introuvable");

    const { error: errUpd } = await supabaseAdmin
      .from("agent_runs")
      .update({ dossier_id: data.dossier_id } as never)
      .eq("id", data.run_id);
    if (errUpd) throw new Error(errUpd.message);

    await logTimelineEvent({
      tenantId,
      dossierId: data.dossier_id,
      actorId: userId,
      eventType: "agent.run_attached",
      title: "Demande rattachée au dossier",
      description: (run as { title: string | null; message: string }).title ?? (run as { message: string }).message.slice(0, 120),
      metadata: { run_id: data.run_id },
    });

    return { ok: true, dossier_id: data.dossier_id };
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
      .is("parent_run_id", null) // ne lister que les conversations racine
      .order("updated_at", { ascending: false })
      .limit(data.limit);

    if (data.scope === "mine") q = q.eq("user_id", userId);
    if (data.status) q = q.eq("status", data.status);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Liste les questions de suivi (children) d'une run racine, ordonnées chronologiquement.
 * Utilisé par l'UI pour afficher le fil conversationnel.
 */
export const listChildRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ parent_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const { data: rows, error } = await supabaseAdmin
      .from("agent_runs")
      .select("id, title, message, status, answer, sources, draft, created_at, updated_at, error_message, refused, refusal_reason, confidence, dossier_id, workflow_instance_id, final_document_ids")
      .eq("tenant_id", tenantId)
      .eq("parent_run_id", data.parent_id)
      .order("created_at", { ascending: true });

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

    // 1. Lock atomique via RPC SECURITY DEFINER (bypass RLS si supabaseAdmin n'a pas le vrai service_role).
    // Audit fix : avant on faisait UPDATE().eq().in().select().maybeSingle() qui pouvait être
    // bloqué silencieusement par RLS → locked=null → "Demande introuvable" alors que la run existait.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { data: lockResult, error: lockErr } = await sb.rpc("lock_agent_run", {
      _run_id: data.id,
      _tenant_id: tenantId,
      _user_id: userId,
    });
    if (lockErr) throw new Error(`Lock failed: ${lockErr.message}`);

    const lockData = (lockResult ?? {}) as { locked?: boolean; row?: unknown; status?: string | null };

    if (!lockData.locked) {
      if (!lockData.status) throw new Error("Demande introuvable");
      return { status: lockData.status, skipped: true };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = lockData.row as any;

    const apiKey = LLM_API_KEY;
    if (!apiKey) {
      await supabaseAdmin
        .from("agent_runs")
        .update({ status: "failed", error_message: "LOVABLE_API_KEY manquant" } as never)
        .eq("id", data.id);
      throw new Error("LOVABLE_API_KEY manquant côté serveur");
    }

    try {
      const message = (run as { message: string }).message;

      // 2a. Récupérer l'IDCC du tenant (convention collective choisie à l'onboarding)
      const { data: tenantRow } = await supabaseAdmin
        .from("tenants")
        .select("idcc")
        .eq("id", tenantId)
        .maybeSingle();
      const idcc = (tenantRow as { idcc: string | null } | null)?.idcc ?? null;

      const ctx: AgentCtx = { userId, tenantId, idcc, apiKey, sources: [] };

      // 2b. Comprendre (en tenant compte des réponses déjà fournies)
      const draft = ((run as { draft: DraftShape }).draft ?? {}) as DraftShape;
      const priorAnswers = (draft.form as Record<string, unknown> | undefined) ?? null;

      // 2c. RAG AVANT classification : chercher les textes de loi applicables
      // pour que le classifieur connaisse les délais légaux et pose les BONNES questions
      let legalContext = "";
      try {
        const { searchLegalSources } = await import("@/server/_shared/legal-rag.server");
        const ragResult = await searchLegalSources(message, { idcc, limit: 6 });
        if (ragResult.ok && ragResult.sources.length > 0) {
          legalContext = ragResult.sources
            .map((s, i) => `[source:${i + 1}] ${s.title}${s.reference ? ` (${s.reference})` : ""}: ${s.excerpt?.slice(0, 300) ?? ""}`)
            .join("\n");
          draft.sources = ragResult.sources;
        }
      } catch (ragErr) {
        // Audit trail : si le RAG préclassification fail, on perd le contexte juridique
        // pour le classifier → l'agent peut redemander des dates fixées par la loi.
        // On logge structuré pour pouvoir détecter ces régressions silencieuses.
        const { logErr } = await import("@/server/_shared/observability.server");
        await logErr({
          fn: "processAgentRun.rag_preclassification",
          err: ragErr,
          userId,
          tenantId,
          ctx: { runId: data.id, messageLength: message.length },
          severity: "warn",
        });
      }

      const classification = await classifyIntent(message, ctx, priorAnswers, legalContext);

      draft.classification = classification;

      // Filtre de sécurité : ne jamais re-demander une info déjà répondue.
      // Comparaison souple : on tokenise les mots-clés significatifs (≥ 4 chars)
      // pour éviter que le LLM contourne le filtre en reformulant la question.
      const hasAnswers = priorAnswers && Object.keys(priorAnswers).length > 0;
      const answeredTokenSets = hasAnswers
        ? Object.keys(priorAnswers).map((k) => {
            const words = k.toLowerCase().replace(/[?(),:;!]/g, " ").split(/\s+/).filter((w) => w.length >= 4);
            return new Set(words);
          })
        : [];

      const filteredMissing = (classification.missing_information ?? []).filter((q) => {
        const s = String(q).toLowerCase().replace(/[?(),:;!]/g, " ");
        const qWords = s.split(/\s+/).filter((w) => w.length >= 4);
        // Si au moins 50% des mots-clés de la question matchent une réponse existante → déjà répondu
        return !answeredTokenSets.some((tokenSet) => {
          if (tokenSet.size === 0) return false;
          const overlap = qWords.filter((w) => tokenSet.has(w)).length;
          return overlap >= Math.max(2, Math.ceil(Math.min(qWords.length, tokenSet.size) * 0.5));
        });
      });
      classification.missing_information = filteredMissing;
      draft.questions = filteredMissing;

      // 3. Décider du prochain état.
      // Si l'utilisateur a déjà répondu aux questions ET le filtre a éliminé
      // toutes les questions restantes → on avance (ready/waiting_validation).
      // `requires_form` ne bloque plus si toutes les infos sont déjà collectées.
      let nextStatus: AgentRunStatus;
      const stillMissing = Array.isArray(filteredMissing) && filteredMissing.length > 0;
      if (stillMissing) {
        nextStatus = "waiting_info";
      } else if (classification.requires_validation) {
        nextStatus = "waiting_validation";
      } else {
        nextStatus = "ready";
      }

      // ─── Auto-orchestration : créer dossier (+ workflow si applicable) DÈS classification ───
      // Avant : seul intent=lancer_procedure déclenchait l'orchestration → 6 autres intents
      // restaient bloqués en waiting_info sans rien créer côté user.
      // Maintenant : 7 intents créent un dossier auto. Pour ceux qui ont un workflow
      // pré-défini, on démarre aussi le workflow + tâches. Sinon dossier simple.
      const INTENTS_WITH_DOSSIER = new Set([
        "lancer_procedure",
        "redaction_document",
        "chiffrage",
        "reclamation",
        "analyse_document",
        "analyse_contrat",
        "conformite",
      ]);

      // Map intent → catégorie de dossier
      const INTENT_TO_CATEGORY: Record<string, string> = {
        lancer_procedure: classification.domain ?? "social",
        redaction_document: classification.domain ?? "general",
        chiffrage: "social",
        reclamation: "commercial",
        analyse_document: "general",
        analyse_contrat: "commercial",
        conformite: classification.domain === "rgpd" ? "rgpd" : (classification.domain ?? "general"),
      };

      let earlyDossierId = (run as { dossier_id: string | null }).dossier_id;
      let earlyWorkflowId: string | null = null;
      let earlyTaskCount = 0;
      let agent360PipelineUsed = false;

      // ─── J5 — Pipeline Agent 360 RAG-first (LRE → Procedure → Workflow → Document) ───
      // Branché uniquement pour intent=lancer_procedure + flag tenant.agent360_pipeline_enabled.
      // En cas d'échec ou de flag off → fallback automatique sur le pipeline legacy ci-dessous.
      if (classification.intent === "lancer_procedure") {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sbTenant = supabaseAdmin as any;
          const { data: tenantRow } = await sbTenant
            .from("tenants")
            .select("agent360_pipeline_enabled")
            .eq("id", tenantId)
            .maybeSingle();
          const flagOn = (tenantRow as { agent360_pipeline_enabled?: boolean | null } | null)
            ?.agent360_pipeline_enabled !== false; // défaut true

          if (flagOn) {
            const message = (run as { message: string }).message;
            const lreCtx = {
              tenantId,
              userId,
              idcc: ctx.idcc,
              agentRunId: data.id,
              mode: "standard" as const,
            };
            const lre = await runLegalReasoning(message, lreCtx);
            if (lre.ok && lre.trace && !lre.trace.refused) {
              const builderCtx = { tenantId, userId, idcc: ctx.idcc };
              const proc = await buildLegalProcedure(lre.trace, builderCtx);
              if (proc.ok && proc.procedure) {
                // Workflow (avec dossier existant si disponible)
                const wf = await buildWorkflowFromProcedure(proc.procedure, {
                  tenantId, userId, dossierId: earlyDossierId,
                });
                if (wf.ok && wf.workflow_instance_id) {
                  earlyWorkflowId = wf.workflow_instance_id;
                  earlyDossierId = wf.dossier_id ?? earlyDossierId;
                  earlyTaskCount = wf.task_count;
                  agent360PipelineUsed = true;

                  // Documents (best-effort, ne bloque pas)
                  await buildDocumentsFromProcedure(
                    proc.procedure,
                    lre.trace.retrieved_sources,
                    { tenantId, userId, dossierId: earlyDossierId },
                  );

                  // Liaison sources → workflow_instance
                  await linkWorkflowToSources(wf.workflow_instance_id, lre.trace.retrieved_sources, {
                    tenantId, userId, dossierId: earlyDossierId,
                  });

                  // Validation humaine systématique si procédure sensible
                  if (proc.procedure.requires_human_review) {
                    await blockSensitiveActionUntilValidation({
                      actionKey: proc.procedure.procedure_slug,
                      subjectType: "agent_run",
                      subjectId: data.id,
                      dossierId: earlyDossierId,
                      ctx: { tenantId, userId, dossierId: earlyDossierId },
                      comment: `Procédure sensible "${proc.procedure.title}" construite par l'Agent 360. Approuvez pour débloquer l'exécution.`,
                    });
                  }

                  console.log(`[processAgentRun] Agent 360 pipeline OK : procedure=${proc.procedure.procedure_slug}, workflow=${earlyWorkflowId}, tasks=${earlyTaskCount}, cache_hit=${proc.cache_hit}`);
                } else if (!wf.ok) {
                  console.warn(`[processAgentRun] Agent 360 buildWorkflowFromProcedure KO: ${wf.error} — fallback legacy`);
                }
              } else if (!proc.ok) {
                console.warn(`[processAgentRun] Agent 360 buildLegalProcedure KO: ${proc.error} — fallback legacy`);
              }
            } else if (!lre.ok) {
              console.warn(`[processAgentRun] Agent 360 runLegalReasoning KO: ${lre.error} — fallback legacy`);
            }
          }
        } catch (e) {
          console.warn("[processAgentRun] Agent 360 pipeline exception, fallback legacy:", e instanceof Error ? e.message : e);
          await captureServerError(
            "agent-runs.processAgentRun.agent360",
            { tenantId, userId, severity: "warn", extra: { run_id: data.id } },
            e,
          );
        }
      }

      if (!agent360PipelineUsed && INTENTS_WITH_DOSSIER.has(classification.intent)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sb = supabaseAdmin as any;

          // 1. Chercher un workflow validé qui matche (scoring lexical)
          const { data: defs } = await sb
            .from("workflow_definitions")
            .select("id, title, slug, category")
            .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
            .in("lifecycle_status", ["ai_validated_auto", "human_validated"])
            .eq("status", "validated")
            .limit(50);

          const topicLower = (classification.topic ?? (run as { message: string }).message).toLowerCase();
          const msgLower = (run as { message: string }).message.toLowerCase();
          const searchStr = `${topicLower} ${msgLower}`;
          const tokens = searchStr.split(/\s+/).filter((w: string) => w.length >= 4);
          let bestDef: { id: string; title: string; slug: string; category: string | null } | null = null;
          let bestScore = 0;
          for (const d of (defs ?? []) as Array<{ id: string; title: string; slug: string; category: string | null }>) {
            const hay = `${d.title} ${d.slug} ${d.category ?? ""}`.toLowerCase();
            const hits = tokens.filter((w: string) => hay.includes(w)).length;
            const score = tokens.length > 0 ? hits / tokens.length : 0;
            if (score > bestScore && score >= 0.3) {
              bestScore = score;
              bestDef = d;
            }
          }

          // 2. Si workflow trouvé → orchestration complète (dossier + workflow + tâches)
          //    Sinon → simple dossier (l'agent générera les tâches/docs dans executeAgentRun)
          if (bestDef) {
            const { data: rpcResult, error: rpcErr } = await sb.rpc("start_procedure_full", {
              _user_id: userId,
              _tenant_id: tenantId,
              _run_id: data.id,
              _definition_id: bestDef.id,
              _definition_title: bestDef.title,
              _existing_dossier_id: earlyDossierId,
              _context: { source: "auto_classification", intent: classification.intent, message: (run as { message: string }).message },
            });
            if (!rpcErr && rpcResult) {
              const result = rpcResult as { dossier_id?: string; workflow_instance_id?: string; task_count?: number };
              earlyDossierId = result.dossier_id ?? earlyDossierId;
              earlyWorkflowId = result.workflow_instance_id ?? null;
              earlyTaskCount = result.task_count ?? 0;
              console.log(`[processAgentRun] Procédure auto-démarrée : ${bestDef.title} (${earlyTaskCount} tâches, dossier=${earlyDossierId})`);
            } else if (rpcErr) {
              console.warn("[processAgentRun] start_procedure_full failed, falling back to dossier-only:", rpcErr.message);
              // Fallback : créer juste le dossier
              await createDossierFallback();
            }
          } else {
            // Pas de workflow → juste un dossier
            await createDossierFallback();
          }

          // Helper de fallback (créer juste un dossier)
          async function createDossierFallback() {
            const category = INTENT_TO_CATEGORY[classification.intent] ?? "general";
            const title = classification.topic
              ? `${classification.topic.slice(0, 80)}`
              : `${classification.intent.replace(/_/g, " ")} — ${new Date().toLocaleDateString("fr-FR")}`;
            const { data: dossierRpc, error: dossierErr } = await sb.rpc("create_dossier_for_run", {
              _user_id: userId,
              _tenant_id: tenantId,
              _run_id: data.id,
              _title: title,
              _category: category,
              _description: `Dossier créé automatiquement par l'agent (intent: ${classification.intent}, domaine: ${classification.domain ?? "n/a"}).`,
              _risk_level: classification.requires_validation ? "high" : "medium",
            });
            if (!dossierErr && dossierRpc) {
              const result = dossierRpc as { dossier_id?: string; created?: boolean };
              earlyDossierId = result.dossier_id ?? earlyDossierId;
              console.log(`[processAgentRun] Dossier auto-créé (intent=${classification.intent}, dossier=${earlyDossierId})`);
            } else if (dossierErr) {
              console.warn("[processAgentRun] create_dossier_for_run failed (non-blocking):", dossierErr.message);
            }
          }
        } catch (e) {
          // Best-effort : ne bloque pas le pipeline si l'orchestration auto échoue
          console.warn("[processAgentRun] Early orchestration failed (non-blocking):", e instanceof Error ? e.message : e);
        }
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
          ...(earlyDossierId ? { dossier_id: earlyDossierId } : {}),
          ...(earlyWorkflowId ? { workflow_instance_id: earlyWorkflowId } : {}),
        } as never)
        .eq("id", data.id);

      // 4. Timeline si rattaché à un dossier
      const dossierId = earlyDossierId;
      if (dossierId) {
        await logTimelineEvent({
          tenantId,
          dossierId,
          actorId: userId,
          eventType: "agent.run.advanced",
          title: `Agent : ${classification.intent} (${nextStatus})`,
          metadata: { run_id: data.id, status: nextStatus, workflow_started: !!earlyWorkflowId },
        });
      }

      return { status: nextStatus, run_id: data.id, dossier_id: earlyDossierId, workflow_instance_id: earlyWorkflowId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      // Audit fix V6 P4 : capture serveur pour observabilité avant de marquer failed
      await captureServerError(
        "agent-runs.processAgentRun",
        { userId, tenantId, severity: "error", extra: { run_id: data.id } },
        err,
      );
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
    // Filtre les clés dangereuses (prototype pollution).
    const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    const safeAnswers: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.answers)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      safeAnswers[k] = v;
    }
    draft.form = { ...((draft.form as Record<string, unknown>) ?? {}), ...safeAnswers };

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

/**
 * Archive en masse TOUTES les conversations du user courant (sauf déjà
 * archivées). Réutilisé par la sidebar pour le bouton "Tout effacer".
 * Bulk update unique = 1 requête au lieu de N appels archiveAgentRun.
 *
 * Sécurité : strict tenant + user filter via WHERE. Pas de hard-delete pour
 * préserver l'audit. Les conversations restent en DB avec status='archived'
 * mais n'apparaissent plus dans listMyRuns (qui n'a pas de filtre status
 * mais on peut en ajouter un côté UI ou ici).
 */
export const archiveAllMyRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const { data, error } = await supabaseAdmin
      .from("agent_runs")
      .update({ status: "archived", archived_at: new Date().toISOString() } as never)
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .neq("status", "archived")
      .select("id");

    if (error) throw new Error(error.message);
    return { ok: true, count: (data as Array<{ id: string }> | null)?.length ?? 0 };
  });

// ---------------------------------------------------------------------------
// WATCHDOG — récupère les runs bloquées en `running` depuis plus de 5 min.
// Appelable manuellement ou via un cron. Reset le statut à `pending` pour relance.
// ---------------------------------------------------------------------------
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECOVERY_RETRIES = 3; // C3 FIX: circuit breaker — max 3 recoveries

export const recoverStuckRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

    // D'abord récupérer les runs bloquées pour vérifier le compteur de retry
    const { data: stuckRuns } = await supabaseAdmin
      .from("agent_runs")
      .select("id, draft")
      .eq("tenant_id", tenantId)
      .in("status", ["running", "executing"])
      .lt("updated_at", threshold)
      .limit(20);

    const recovered: string[] = [];
    const abandoned: string[] = [];

    for (const run of (stuckRuns ?? []) as Array<{ id: string; draft: Record<string, unknown> | null }>) {
      const retryCount = ((run.draft as any)?.recovery_count as number) ?? 0;

      if (retryCount >= MAX_RECOVERY_RETRIES) {
        // Circuit breaker : trop de retries → marquer comme failed définitivement
        await supabaseAdmin
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: `Abandon après ${MAX_RECOVERY_RETRIES} tentatives de recovery`,
          } as never)
          .eq("id", run.id);
        abandoned.push(run.id);
        console.error(`[watchdog] Abandoned run ${run.id} after ${MAX_RECOVERY_RETRIES} retries`);
      } else {
        // Incrémenter le compteur et remettre en pending
        const updatedDraft = { ...(run.draft ?? {}), recovery_count: retryCount + 1 };
        await supabaseAdmin
          .from("agent_runs")
          .update({
            status: "pending",
            draft: updatedDraft,
            error_message: `Auto-recovery #${retryCount + 1}: run bloquée`,
          } as never)
          .eq("id", run.id);
        recovered.push(run.id);
      }
    }

    if (recovered.length > 0 || abandoned.length > 0) {
      console.warn(`[watchdog] Tenant ${tenantId}: recovered=${recovered.length}, abandoned=${abandoned.length}`);
    }
    return { recovered: recovered.length, abandoned: abandoned.length, ids: recovered };
  });

// ---------------------------------------------------------------------------
// EXÉCUTION FINALE — status=ready → executed.
// Sourcing RAG obligatoire si requires_rag, rédaction de la réponse + procédure.
// (Génération des documents pré-remplis viendra dans une étape suivante en
// s'appuyant sur templates / generation.functions existants.)
// ---------------------------------------------------------------------------

import { resolveChatModel } from "@/server/_shared/llm-models.server";
import { LLM_API_KEY } from "@/server/_shared/constants.server";

// EXEC_SYSTEM supprimé — remplacé par AGENT_SYSTEM_PROMPT (shared config) + boucle agentique

export const executeAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    // Audit fix : rate limit pour éviter DoS coût LLM (chaque execute = 1+ appel LLM).
    // 20/min/user : couvre l'usage normal + retries, bloque les loops malicieux.
    const { enforceRateLimit } = await import("@/server/_shared/rate-limit.server");
    await enforceRateLimit(userId, "execute-agent-run", 20);

    // C1 FIX: Lock atomique — empêche les exécutions concurrentes.
    // Seul le premier appel obtient le run; les suivants voient status != 'ready'.
    const { data: locked, error: lockErr } = await supabaseAdmin
      .from("agent_runs")
      .update({ status: "executing" } as never)
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .eq("status", "ready")
      .select("*")
      .maybeSingle();
    if (lockErr) throw new Error(lockErr.message);
    if (!locked) {
      // Vérifier pourquoi on n'a pas obtenu le lock
      const { data: existing } = await supabaseAdmin
        .from("agent_runs")
        .select("status")
        .eq("id", data.id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!existing) throw new Error("Demande introuvable");
      throw new Error(`Statut invalide pour exécution: ${(existing as { status: string }).status}`);
    }

    const r = locked as unknown as {
      status: string;
      message: string;
      draft: DraftShape;
      requires_rag: boolean | null;
      topic: string | null;
      dossier_id: string | null;
      parent_run_id: string | null;
    };

    const apiKey = LLM_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY manquant");

    try {
      // 1. Tenant IDCC pour le RAG
      const { data: tenant } = await supabaseAdmin
        .from("tenants")
        .select("idcc")
        .eq("id", tenantId)
        .maybeSingle();
      const idcc = (tenant as { idcc: string | null } | null)?.idcc ?? null;

      // 2. RAG pré-fetch (best-effort) — l'agent peut appeler search_law lui-même si besoin
      let sources: Array<Record<string, unknown>> = [];
      if (r.requires_rag !== false) {
        const ragQuery = r.topic || r.message;
        const result = await searchLegalSources(ragQuery, { idcc, limit: 6 });
        sources = result.sources as unknown as Array<Record<string, unknown>>;
        // Pas de refus dur : l'agent dispose de search_law pour chercher lui-même
      }

      // 3. Construire le contexte pour l'IA
      const sourcesBlock = sources
        .map((s, i) => `[source:${i + 1}] ${s.title} — ${s.reference ?? ""}\n${s.excerpt}`)
        .join("\n\n");
      const collected = r.draft?.form ?? {};

      // Mode conversation : si la run est un suivi, on charge le fil parent
      // (jusqu'à 3 niveaux) pour donner le contexte à l'IA.
      const conversation: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (r.parent_run_id) {
        let cursor: string | null = r.parent_run_id;
        let safety = 3;
        const stack: Array<{ message: string; answer: string }> = [];
        while (cursor && safety > 0) {
          const { data: p } = await supabaseAdmin
            .from("agent_runs")
            .select("message, answer, parent_run_id")
            .eq("id", cursor)
            .eq("tenant_id", tenantId)
            .maybeSingle();
          if (!p) break;
          const pr = p as { message: string; answer: string | null; parent_run_id: string | null };
          stack.push({ message: pr.message, answer: pr.answer ?? "" });
          cursor = pr.parent_run_id;
          safety -= 1;
        }
        for (const turn of stack.reverse()) {
          conversation.push({ role: "user", content: turn.message });
          if (turn.answer) conversation.push({ role: "assistant", content: turn.answer });
        }
      }

      const safeMessage = sanitizePromptInput(r.message, { maxLength: 8000 });
      const userMsg = `DEMANDE: ${safeMessage}

INFOS COLLECTÉES:
${JSON.stringify(collected, null, 2)}

SOURCES JURIDIQUES:
${sourcesBlock || "(aucune)"}`;

      // 4. Appel IA — boucle agentique complète (17 outils, multi-round)
      // Audit fix : on injecte la mémoire (sujets précédents du dossier, préférences user)
      // dans le system prompt pour que l'agent ait du contexte continu.
      let memoryPreambleStr = "";
      try {
        const { recallMemory, memoryPreamble } = await import("@/server/_shared/agent-memory.server");
        const memories = await recallMemory({
          tenantId,
          userId,
          dossierId: r.dossier_id ?? undefined,
          limit: 5,
        });
        if (memories.length > 0) memoryPreambleStr = "\n\n" + memoryPreamble(memories);
      } catch (e) {
        // best-effort, ne bloque pas le run
        console.warn("[executeAgentRun] memory recall failed:", e);
      }
      const systemWithGuard = `${AGENT_SYSTEM_PROMPT}\n\n${PROMPT_INJECTION_GUARD}\n\nSOURCES JURIDIQUES PRÉ-CHARGÉES:\n${sourcesBlock || "(aucune — appelle search_law si besoin)"}${memoryPreambleStr}`;
      const model = await resolveChatModel(tenantId);
      const ctx: AgentCtx = {
        userId,
        tenantId,
        idcc,
        apiKey,
        sources: sources.map((s, i) => ({
          n: i + 1,
          title: String((s as Record<string, unknown>).title ?? ""),
          ref: ((s as Record<string, unknown>).reference as string) ?? null,
          url: ((s as Record<string, unknown>).url as string) ?? null,
        })),
      };
      const loopResult = await runAgentLoop({
        apiKey,
        model,
        tools: AGENT_TOOLS,
        initialMessages: [
          { role: "system", content: systemWithGuard },
          ...conversation,
          { role: "user", content: userMsg },
        ],
        ctx,
        runId: data.id,
        tenantId,
        maxRounds: 6,
      });

      // Extraire réponse structurée si le LLM a produit du JSON, sinon prendre le texte brut
      let parsed: { answer?: string; procedure?: unknown[]; risks?: unknown[]; next_actions?: unknown[] } = {};
      const rawAnswer = loopResult.answer;
      try {
        const maybeJson = safeParseJSON(rawAnswer);
        if (maybeJson && typeof maybeJson === "object" && (maybeJson.answer || maybeJson.procedure || maybeJson.risks)) {
          parsed = maybeJson;
        } else {
          parsed = { answer: rawAnswer };
        }
      } catch {
        parsed = { answer: rawAnswer };
      }

      // 5. Mettre à jour la run
      // Disclaimer anti-hallucination : uniquement si ni RAG pré-chargé ni search_law appelé
      const usedSearchLaw = loopResult.trace.some((t) => t.tool === "search_law" && t.succeeded);
      if (sources.length === 0 && !usedSearchLaw && parsed.answer) {
        const disclaimer =
          "⚠️ **Attention** : aucune source juridique n'a été trouvée dans la base pour cette question. " +
          "La réponse ci-dessous est générée par l'IA sans appui sur les textes de loi indexés. " +
          "Consultez un professionnel avant d'agir.\n\n---\n\n";
        parsed.answer = disclaimer + parsed.answer;
      }
      const draft = { ...(r.draft ?? {}) } as DraftShape;
      draft.analysis = { answer: parsed.answer ?? "", risks: parsed.risks ?? [] };
      draft.procedure = parsed.procedure ?? [];
      draft.sources = sources;

      // 5bis. Actions spécifiques selon l'intent (invisibles pour l'utilisateur,
      // alimentent draft + final_document_ids + contract_deadlines + timeline du dossier)
      const intent = ((locked as Record<string, unknown>).intent as string | null) ?? "autre";
      const finalDocIds: string[] = [];
      const extras = await runIntentActions({
        intent,
        run: r,
        draft,
        userId,
        tenantId,
        runId: data.id,
      });
      if (extras.documentIds.length) finalDocIds.push(...extras.documentIds);
      if (extras.timeline) draft.timeline = extras.timeline;
      if (extras.deadlines) draft.deadlines = extras.deadlines;
      if (extras.suggestedTemplates) draft.suggestedTemplates = extras.suggestedTemplates;

      // AG1 FIX: Rejeter les réponses vides
      const finalAnswer = (parsed.answer ?? "").trim();
      if (!finalAnswer) {
        console.warn("[executeAgentRun] LLM returned empty answer for run", data.id);
        await supabaseAdmin
          .from("agent_runs")
          .update({ status: "failed", error_message: "L'IA n'a pas pu générer de réponse. Réessayez." } as never)
          .eq("id", data.id);
        return { ok: false, answer: "", sources_count: 0 };
      }

      const updatePayload: Record<string, unknown> = {
        status: "executed",
        executed_at: new Date().toISOString(),
        answer: finalAnswer,
        sources,
        draft,
        final_document_ids: finalDocIds,
      };
      // Rattacher le workflow si un a été démarré par runIntentActions
      if (extras.workflowInstanceId) {
        updatePayload.workflow_instance_id = extras.workflowInstanceId;
      }

      await supabaseAdmin
        .from("agent_runs")
        .update(updatePayload as never)
        .eq("id", data.id);

      // 6. Timeline
      if (r.dossier_id) {
        await logTimelineEvent({
          tenantId,
          dossierId: r.dossier_id,
          actorId: userId,
          eventType: "agent.run.executed",
          title: "Réponse de l'agent générée",
          metadata: { run_id: data.id, sources_count: sources.length },
        });
      }

      // C2 FIX: Post-response pipeline (business rules, mémoire, détection infos manquantes)
      try {
        const { runPostResponsePipeline } = await import("@/server/_shared/agent-post-response.server");
        await runPostResponsePipeline({
          agentRunId: data.id,
          tenantId,
          userId,
          message: r.message,
          answer: finalAnswer,
          intent,
          domain: ((locked as Record<string, unknown>).domain as string) ?? "",
          topic: r.topic ?? "",
          trace: loopResult.trace,
          refused: false,
          dossierId: r.dossier_id,
        });
      } catch (postErr) {
        // Post-response non bloquant — log et continue
        console.error("[executeAgentRun] Post-response pipeline failed:", postErr);
        // Audit fix V6 P4 : on capture aussi côté serveur pour pouvoir le retrouver
        await captureServerError(
          "agent-runs.executeAgentRun.postResponse",
          { userId, tenantId, severity: "warn", extra: { run_id: data.id } },
          postErr,
        );
      }

      return { ok: true, answer: finalAnswer, sources_count: sources.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      // Audit fix V6 P4 : capture serveur pour observabilité
      await captureServerError(
        "agent-runs.executeAgentRun",
        { userId, tenantId, severity: "error", extra: { run_id: data.id } },
        err,
      );
      await supabaseAdmin
        .from("agent_runs")
        .update({ status: "failed", error_message: msg } as never)
        .eq("id", data.id);
      throw err;
    }
  });
