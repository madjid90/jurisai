// Server functions de base pour la "boîte aux lettres" de l'agent (agent_runs).
// Étape 1 du plan async : créer une demande, la lire, lister les demandes courantes.
// Le moteur d'exécution (worker) viendra dans une étape suivante.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import { classifyIntent, safeParseJSON, searchDossier, type AgentCtx } from "@/server/_shared/agent-tools.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";
import { searchLegalSources } from "@/server/_shared/legal-rag.server";
import { runIntentActions } from "@/server/_shared/agent-intent-actions.server";
import { llmFetch } from "@/server/_shared/llm-fetch.server";
import { sanitizePromptInput, PROMPT_INJECTION_GUARD } from "@/server/_shared/prompt-sanitizer.server";

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

    // B1 FIX: Rate limit sur createAgentRun (10/min/user)
    const { data: rl, error: rlErr } = await supabaseAdmin.rpc("check_rate_limit", {
      p_user_id: userId,
      p_endpoint: "create-agent-run",
      p_max_per_minute: 10,
    });
    if (rlErr) {
      console.error("[createAgentRun] Rate limit check failed:", rlErr);
      throw new Error("Vérification du rate limit échouée — réessayez");
    }
    if (Array.isArray(rl) && rl[0] && !rl[0].allowed) {
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

    const { data: row, error } = await supabaseAdmin
      .from("agent_runs")
      .insert({
        user_id: userId,
        tenant_id: tenantId,
        dossier_id: inheritedDossierId,
        parent_run_id: data.parent_run_id ?? null,
        message: data.message,
        title: data.title ?? data.message.slice(0, 80),
        status: "pending",
        draft,
      } as never)
      .select("id, status, created_at")
      .single();

    if (error) throw new Error(error.message);

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

    // 1. Lock atomique : update conditionnel sur status pending|waiting_info → running.
    // Le RETURNING garantit qu'un seul appel concurrent obtient la run.
    const { data: locked, error: lockErr } = await supabaseAdmin
      .from("agent_runs")
      .update({ status: "running" } as never)
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .in("status", ["pending", "waiting_info"])
      .select("*")
      .maybeSingle();
    if (lockErr) throw new Error(lockErr.message);

    // Pas de lock obtenu → soit run inexistant, soit déjà en cours.
    if (!locked) {
      const { data: existing } = await supabaseAdmin
        .from("agent_runs")
        .select("status")
        .eq("id", data.id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!existing) throw new Error("Demande introuvable");
      return { status: (existing as { status: string }).status, skipped: true };
    }
    const run = locked;

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
        console.warn("[processAgentRun] RAG pre-classification failed", ragErr);
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
import { AI_GATEWAY, LLM_API_KEY, LLM_TEMPERATURES, LLM_MAX_TOKENS } from "@/server/_shared/constants.server";

const EXEC_SYSTEM = `Tu es JurisAI, copilote juridique transverse.
Tu reçois une demande utilisateur, sa classification, les infos collectées et des extraits juridiques sourcés.
Rédige une réponse en JSON STRICT :
{
  "answer": string (markdown, ton professionnel, cite [source:N]),
  "procedure": [{ "step": number, "title": string, "description": string, "legal_basis": [number] }],
  "risks": [string],
  "next_actions": [string]
}
RÈGLES:
- Toute affirmation juridique doit citer [source:N]. Si aucune source n'a été fournie, mets answer="Je ne peux pas répondre sans source juridique fiable" et procedure=[].
- Date courante : 2026.
- Reste dans le périmètre demandé. Pas d'avis hors juridique.
- Tu ne donnes jamais de consultation se substituant à un avocat.

HIÉRARCHIE DES SOURCES :
1. Textes législatifs (Code du travail, lois, décrets) — toujours citer en premier.
2. Convention collective / accord applicable.
3. Jurisprudence — pour illustrer l'interprétation.
Ne cite JAMAIS la jurisprudence seule sans le texte de loi qu'elle interprète.`;

export const executeAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

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

      // 2. RAG si nécessaire
      let sources: Array<Record<string, unknown>> = [];
      if (r.requires_rag !== false) {
        const ragQuery = r.topic || r.message;
        const result = await searchLegalSources(ragQuery, { idcc, limit: 6 });
        sources = result.sources as unknown as Array<Record<string, unknown>>;
        if (!result.ok || sources.length === 0) {
          await supabaseAdmin
            .from("agent_runs")
            .update({
              status: "failed",
              error_message: "Aucune source juridique fiable — refus motivé",
              refused: true,
              refusal_reason: result.reason ?? "Aucune source pertinente trouvée",
            } as never)
            .eq("id", data.id);
          throw new Error("RAG insuffisant — refus");
        }
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

      // 4. Appel IA
      const systemWithGuard = `${EXEC_SYSTEM}\n\n${PROMPT_INJECTION_GUARD}`;
      const aiRes = await llmFetch(`${AI_GATEWAY}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: await resolveChatModel(tenantId),
          temperature: LLM_TEMPERATURES.chat,
          max_tokens: LLM_MAX_TOKENS.chat,
          messages: [
            { role: "system", content: systemWithGuard },
            ...conversation,
            { role: "user", content: userMsg },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!aiRes.ok) throw new Error(`IA ${aiRes.status}`);
      const aiJson = await aiRes.json();
      const raw = aiJson.choices?.[0]?.message?.content ?? "{}";
      let parsed: { answer?: string; procedure?: unknown[]; risks?: unknown[]; next_actions?: unknown[] } = {};
      try {
        parsed = safeParseJSON(raw);
      } catch {
        parsed = { answer: raw };
      }

      // 5. Mettre à jour la run
      // Disclaimer anti-hallucination quand aucune source RAG n'a été utilisée.
      if (sources.length === 0 && parsed.answer) {
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
          trace: [],
          refused: false,
          dossierId: r.dossier_id,
        });
      } catch (postErr) {
        // Post-response non bloquant — log et continue
        console.error("[executeAgentRun] Post-response pipeline failed:", postErr);
      }

      return { ok: true, answer: finalAnswer, sources_count: sources.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      await supabaseAdmin
        .from("agent_runs")
        .update({ status: "failed", error_message: msg } as never)
        .eq("id", data.id);
      throw err;
    }
  });
