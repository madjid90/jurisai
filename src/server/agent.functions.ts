// JurisAI Agent — pipeline structuré (Comprendre → Sourcer → Proposer → Préparer → Valider → Archiver → Suivre).
// Migré depuis l'edge function legal-agent vers createServerFn (Core rule).
// Sortie structurée : intent, domain, topic, confidence, suggested_actions, missing_information.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import {
  type AgentCtx,
  classifyIntent,
} from "@/server/_shared/agent-tools.server";
import { routeTool } from "@/server/_shared/agent-tool-router.server";
import { recallMemory, memoryPreamble } from "@/server/_shared/agent-memory.server";
import { runPostResponsePipeline } from "@/server/_shared/agent-post-response.server";
import type { AgentLoopResult, AgentLoopTrace } from "@/server/_shared/agent-loop.server";
import { resolveChatModel } from "@/server/_shared/llm-models.server";
import { LLM_API_KEY } from "@/server/_shared/constants.server";

const MAX_ROUNDS = 6;

const SYSTEM_PROMPT = `Tu es **JurisAI**, copilote juridique transverse pour cabinets et entreprises (RH, commercial, sociétés, RGPD, fiscal, contentieux, administratif).

LOGIQUE OBLIGATOIRE : Comprendre → Sourcer → Proposer → Préparer → Valider → Exécuter → Archiver → Suivre → Alerter.

RÈGLES STRICTES :
1. Pour toute affirmation juridique : appelle search_law et cite via [source:N]. Pas de source = refus motivé.
2. Pour tout document à risque (licenciement, mise en demeure, transaction, contentieux, dépôt légal) : passe par request_validation, jamais d'exécution directe.
3. Toute action significative sur un dossier doit produire une trace (les outils log_timeline automatiquement).
4. Si la demande est hors juridique, redirige poliment.
5. Réponds en français, ton professionnel, structure claire.
6. Tu ne donnes jamais de consultation se substituant à un avocat. Tes réponses sont informatives et ne constituent pas un avis juridique.

HIÉRARCHIE DES SOURCES — structure ta réponse en respectant la hiérarchie normative :
1. **Textes législatifs** (Code du travail, lois, décrets) — toujours citer en premier.
2. **Convention collective / accord** applicable — si pertinent au cas.
3. **Jurisprudence** — pour illustrer l'interprétation des textes.
Ne cite JAMAIS la jurisprudence seule sans le texte de loi qu'elle interprète.

Date courante : 2026.`;

const TOOLS = [
  { type: "function", function: { name: "search_law", description: "RAG dans les sources juridiques officielles. À appeler avant toute affirmation.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "dossier_context", description: "Récupère le contexte d'un dossier (timeline, tâches, risques, échéances).", parameters: { type: "object", properties: { dossier_id: { type: "string" } }, required: ["dossier_id"] } } },
  { type: "function", function: { name: "identify_risk", description: "Enregistre un risque juridique sur un dossier.", parameters: { type: "object", properties: { dossier_id: { type: "string" }, title: { type: "string" }, severity: { type: "string", enum: ["low", "medium", "high", "critical"] }, legal_basis: { type: "string" }, description: { type: "string" } }, required: ["dossier_id", "title", "severity"] } } },
  { type: "function", function: { name: "propose_document", description: "Initie une session de génération de document. Pour docs sensibles → demande de validation auto.", parameters: { type: "object", properties: { dossier_id: { type: "string" }, doc_type: { type: "string" }, domain: { type: "string" }, params: { type: "object" } }, required: ["dossier_id", "doc_type"] } } },
  { type: "function", function: { name: "request_validation", description: "Crée une demande de validation hiérarchique avant exécution d'une action engageante.", parameters: { type: "object", properties: { dossier_id: { type: "string" }, action_type: { type: "string" }, reason: { type: "string" }, payload: { type: "object" } }, required: ["dossier_id", "action_type"] } } },
  { type: "function", function: { name: "schedule_reminder", description: "Programme un rappel.", parameters: { type: "object", properties: { dossier_id: { type: "string" }, title: { type: "string" }, remind_at: { type: "string" }, channel: { type: "string", enum: ["in_app", "email"] } }, required: ["title", "remind_at"] } } },
  { type: "function", function: { name: "create_task", description: "Crée une tâche dans un dossier.", parameters: { type: "object", properties: { dossier_id: { type: "string" }, title: { type: "string" }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }, due_date: { type: "string" } }, required: ["dossier_id", "title"] } } },
  { type: "function", function: { name: "update_task", description: "Met à jour le statut, la priorité ou le titre d'une tâche existante.", parameters: { type: "object", properties: { task_id: { type: "string" }, dossier_id: { type: "string" }, status: { type: "string", enum: ["todo", "in_progress", "done", "cancelled"] }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }, title: { type: "string" } }, required: ["task_id", "dossier_id"] } } },
  { type: "function", function: { name: "create_deadline", description: "Crée une échéance.", parameters: { type: "object", properties: { dossier_id: { type: "string" }, title: { type: "string" }, due_date: { type: "string" } }, required: ["dossier_id", "title", "due_date"] } } },
  { type: "function", function: { name: "search_dossier", description: "Recherche dans les dossiers du tenant par titre ou description.", parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } } },
  { type: "function", function: { name: "create_dossier", description: "Crée un nouveau dossier juridique pour le tenant.", parameters: { type: "object", properties: { title: { type: "string" }, category: { type: "string" }, description: { type: "string" }, client_id: { type: "string" }, risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] } }, required: ["title"] } } },
  { type: "function", function: { name: "start_workflow", description: "Instancie une procédure (workflow) depuis sa définition.", parameters: { type: "object", properties: { definition_id: { type: "string" }, definition_slug: { type: "string" }, title: { type: "string" }, dossier_id: { type: "string" }, client_id: { type: "string" }, context: { type: "object" } } } } },
  { type: "function", function: { name: "analyze_document", description: "Analyse un document (résumé, type, risques, clauses manquantes).", parameters: { type: "object", properties: { document_id: { type: "string" }, dossier_id: { type: "string" } }, required: ["document_id"] } } },
  { type: "function", function: { name: "generate_report", description: "Génère un rapport markdown synthétisant un dossier.", parameters: { type: "object", properties: { dossier_id: { type: "string" }, report_type: { type: "string" } }, required: ["dossier_id"] } } },
  { type: "function", function: { name: "generate_workflow", description: "Génère une nouvelle procédure (workflow) juridique à partir d'une demande en langage naturel.", parameters: { type: "object", properties: { prompt: { type: "string", description: "Description en langage naturel de la procédure à générer." }, category: { type: "string", description: "Domaine juridique : social, commercial, rgpd, fiscal, contentieux, societes, administratif." } }, required: ["prompt"] } } },
  { type: "function", function: { name: "run_workflow_step", description: "Exécute l'étape courante d'un workflow déjà instancié.", parameters: { type: "object", properties: { instance_id: { type: "string" }, step_index: { type: "number" }, notes: { type: "string" } }, required: ["instance_id", "step_index"] } } },
  { type: "function", function: { name: "calculate_indemnity", description: "Calcule les indemnités de rupture (licenciement, rupture conventionnelle, retraite) en comparant légal vs conventionnel (principe de faveur). Retourne le détail de chaque composante avec références légales.", parameters: { type: "object", properties: { salaire_mensuel_brut: { type: "number", description: "Salaire mensuel brut de référence en euros" }, salaire_moyen_12m: { type: "number", description: "Moyenne des 12 derniers mois (optionnel)" }, salaire_moyen_3m: { type: "number", description: "Moyenne des 3 derniers mois avec primes proratisées (optionnel)" }, anciennete_mois: { type: "number", description: "Ancienneté totale en mois" }, motif: { type: "string", enum: ["licenciement_cause_reelle", "licenciement_faute_grave", "licenciement_faute_lourde", "licenciement_eco", "rupture_conventionnelle", "mise_retraite", "depart_retraite", "licenciement_inaptitude_pro", "licenciement_inaptitude_non_pro"], description: "Motif de la rupture" }, idcc: { type: "string", description: "Code IDCC de la convention collective (ex: 1486 pour Syntec)" }, categorie: { type: "string", description: "Catégorie professionnelle : cadre, non-cadre, ETAM..." }, taille_entreprise: { type: "string", enum: ["standard", "small"], description: "standard (≥11 salariés) ou small (<11)" }, date_effet: { type: "string", description: "Date du fait générateur (YYYY-MM-DD)" }, jours_conges_non_pris: { type: "number", description: "Nombre de jours de congés non pris" }, dossier_id: { type: "string", description: "ID du dossier lié (optionnel)" } }, required: ["salaire_mensuel_brut", "anciennete_mois", "motif"] } } },
];


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentSuggestedAction = { kind: string; label: string; payload?: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentTraceItem = {
  tool: string;
  args: any;
  sensitive: boolean;
  succeeded: boolean;
  validation_request_id: string | null;
};
export type AgentRunOutput = {
  run_id: string;
  intent: string;
  domain: string;
  topic: string;
  confidence: number;
  requires_rag: boolean;
  requires_document_upload: boolean;
  requires_form: boolean;
  requires_validation: boolean;
  suggested_actions: AgentSuggestedAction[];
  missing_information: string[];
  answer: string;
  refused: boolean;
  refusal_reason: string | null;
  sources: Array<{ n: number; title: string; ref: string | null; url: string | null }>;
  trace: AgentTraceItem[];
};

export const runLegalAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        message: z.string().trim().min(1).max(4000),
        dossier_id: z.string().uuid().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<AgentRunOutput> => {
    const ctxAuth = context as { userId: string };
    const userId = ctxAuth.userId;
    const tenantId = await getTenantId(userId);
    const startedAt = Date.now();

    const apiKey = LLM_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY manquant côté serveur");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;

    // Quotas / rate-limit
    const { data: rl } = await sb.rpc("check_rate_limit", {
      p_user_id: userId,
      p_endpoint: "agent",
      p_max_per_minute: 5,
    });
    if (Array.isArray(rl) && rl[0] && !rl[0].allowed) {
      throw new Error("Trop de requêtes (5/min).");
    }
    const { data: quotaOk } = await sb.rpc("increment_questions_used", {
      _tenant_id: tenantId,
    });
    if (!quotaOk) throw new Error("Quota mensuel atteint.");

    // IDCC du tenant
    const { data: tenant } = await sb
      .from("tenants")
      .select("idcc")
      .eq("id", tenantId)
      .maybeSingle();
    const idcc = (tenant as { idcc: string | null } | null)?.idcc ?? null;

    const ctx: AgentCtx = { userId, tenantId, idcc, apiKey, sources: [] };

    // ÉTAPE 1 : Comprendre — classification structurée
    let classification;
    try {
      classification = await classifyIntent(data.message, ctx);
    } catch (e) {
      classification = {
        intent: "autre",
        domain: "general",
        topic: "",
        confidence: 0,
        requires_rag: true,
        requires_document_upload: false,
        requires_form: false,
        requires_validation: false,
        suggested_actions: [],
        missing_information: [],
      };
      console.error("classifyIntent failed:", (e as Error).message);
    }

    // Pré-créer la run pour avoir un id
    const { data: runRow } = await sb
      .from("agent_runs")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        dossier_id: data.dossier_id ?? null,
        message: data.message,
        intent: classification.intent,
        domain: classification.domain,
        topic: classification.topic,
        confidence: classification.confidence,
        requires_rag: classification.requires_rag,
        requires_document_upload: classification.requires_document_upload,
        requires_form: classification.requires_form,
        requires_validation: classification.requires_validation,
        suggested_actions: classification.suggested_actions,
        missing_information: classification.missing_information,
      })
      .select("id")
      .single();
    const runId = (runRow as { id: string }).id;

    // ÉTAPE 2-7 : boucle outils (extraite dans agent-loop.server.ts)
    const { sanitizePromptInput, PROMPT_INJECTION_GUARD } = await import(
      "@/server/_shared/prompt-sanitizer.server"
    );
    const safeMessage = sanitizePromptInput(data.message, { maxLength: 4000 });

    // Mémoire agentique : on rappelle les souvenirs pertinents (tenant + dossier + user).
    const memories = await recallMemory({
      tenantId,
      userId,
      dossierId: data.dossier_id,
      limit: 8,
    }).catch(() => []);
    const memoryBlock = memoryPreamble(memories);

    const userPreamble = data.dossier_id
      ? `[Contexte dossier actif : ${data.dossier_id}]\nClassification préalable : intent=${classification.intent}, domaine=${classification.domain}, sujet="${classification.topic}".\n\nDemande utilisateur :\n${safeMessage}`
      : `Classification préalable : intent=${classification.intent}, domaine=${classification.domain}, sujet="${classification.topic}".\n\nDemande utilisateur :\n${safeMessage}`;

    const systemContent = [SYSTEM_PROMPT, PROMPT_INJECTION_GUARD, memoryBlock]
      .filter(Boolean)
      .join("\n\n");
    const initialMessages: Array<Record<string, unknown>> = [
      { role: "system", content: systemContent },
      { role: "user", content: userPreamble },
    ];

    const { runAgentLoop } = await import("@/server/_shared/agent-loop.server");
    const chatModel = await resolveChatModel(tenantId);
    const loopResult: AgentLoopResult = await runAgentLoop({
      apiKey,
      model: chatModel,
      tools: TOOLS,
      initialMessages,
      ctx,
      runId,
      tenantId,
      maxRounds: MAX_ROUNDS,
    });
    let answer = loopResult.answer;
    const trace: AgentLoopTrace[] = loopResult.trace;

    let refused = false;
    let refusalReason: string | null = null;
    if (!answer.trim()) {
      refused = true;
      refusalReason = "L'agent n'a pas pu finaliser la réponse — réessayez ou précisez la demande.";
      answer = refusalReason;
    } else if (
      classification.requires_rag &&
      ctx.sources.length === 0 &&
      !trace.some((t) => t.tool === "search_law")
    ) {
      refused = true;
      refusalReason = "Réponse refusée : aucune source juridique consultée pour une affirmation sensible.";
    }

    // Finaliser la run
    await sb
      .from("agent_runs")
      .update({
        answer,
        sources: ctx.sources,
        refused,
        refusal_reason: refusalReason,
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", runId);

    // Audit
    await sb.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      action: "agent.run",
      resource_type: "agent_run",
      resource_id: runId,
      metadata: {
        intent: classification.intent,
        domain: classification.domain,
        tool_calls: trace.map((t) => t.tool),
        sources_count: ctx.sources.length,
        refused,
      },
    });

    // Pipeline post-réponse : règle métier + complétude + validation + mémoire + timeline.
    const postCheck = await runPostResponsePipeline({
      tenantId,
      userId,
      agentRunId: runId,
      dossierId: data.dossier_id ?? null,
      message: data.message,
      answer,
      intent: classification.intent,
      domain: classification.domain,
      topic: classification.topic,
      trace,
      refused,
    }).catch((e) => {
      console.error("post-response pipeline failed:", (e as Error).message);
      return null;
    });

    return {
      run_id: runId,
      intent: classification.intent,
      domain: classification.domain,
      topic: classification.topic,
      confidence: classification.confidence,
      requires_rag: classification.requires_rag,
      requires_document_upload: classification.requires_document_upload,
      requires_form: classification.requires_form,
      requires_validation:
        classification.requires_validation || (postCheck?.requires_validation ?? false),
      suggested_actions: classification.suggested_actions,
      missing_information:
        postCheck?.missing_information && postCheck.missing_information.length > 0
          ? postCheck.missing_information
          : classification.missing_information,
      answer,
      refused,
      refusal_reason: refusalReason,
      sources: ctx.sources,
      trace,
    };
  });

/** Liste les dernières exécutions de l'agent pour le tenant courant. */
export const listAgentRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ limit: z.number().min(1).max(50).optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ctxAuth = context as { userId: string };
    const tenantId = await getTenantId(ctxAuth.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await supabaseAdmin
      .from("agent_runs")
      .select(
        "id, message, intent, domain, topic, confidence, refused, created_at, dossier_id",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 20);
    return rows ?? [];
  });
