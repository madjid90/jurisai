// JurisAI Agent — pipeline structuré (Comprendre → Sourcer → Proposer → Préparer → Valider → Archiver → Suivre).
// Migré depuis l'edge function legal-agent vers createServerFn (Core rule).
// Sortie structurée : intent, domain, topic, confidence, suggested_actions, missing_information.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "./_shared/tenant.server";
import {
  type AgentCtx,
  type ToolOutcome,
  classifyIntent,
  searchLaw,
  dossierContext,
  identifyRisk,
  proposeDocument,
  requestValidation,
  scheduleReminder,
  createTask,
  createDeadline,
  searchDossier,
  createDossierTool,
  startWorkflowTool,
  analyzeDocumentTool,
  generateReportTool,
  generateWorkflowTool,
  runWorkflowStepTool,
} from "./_shared/agent-tools.server";
import { llmFetch } from "./_shared/llm-fetch.server";

import { resolveChatModel } from "./_shared/llm-models.server";

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1";
const MAX_ROUNDS = 6;

const SYSTEM_PROMPT = `Tu es **JurisAI**, copilote juridique transverse pour cabinets et entreprises (RH, commercial, sociétés, RGPD, fiscal, contentieux, administratif).

LOGIQUE OBLIGATOIRE : Comprendre → Sourcer → Proposer → Préparer → Valider → Exécuter → Archiver → Suivre → Alerter.

RÈGLES STRICTES :
1. Pour toute affirmation juridique : appelle search_law et cite via [source:N]. Pas de source = refus motivé.
2. Pour tout document à risque (licenciement, mise en demeure, transaction, contentieux, dépôt légal) : passe par request_validation, jamais d'exécution directe.
3. Toute action significative sur un dossier doit produire une trace (les outils log_timeline automatiquement).
4. Si la demande est hors juridique, redirige poliment.
5. Réponds en français, ton professionnel, structure claire.

Date courante : 2026.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_law",
      description: "RAG dans les sources juridiques officielles. À appeler avant toute affirmation.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dossier_context",
      description: "Récupère le contexte d'un dossier (timeline, tâches, risques, échéances).",
      parameters: {
        type: "object",
        properties: { dossier_id: { type: "string" } },
        required: ["dossier_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "identify_risk",
      description: "Enregistre un risque juridique sur un dossier.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          title: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          legal_basis: { type: "string" },
          description: { type: "string" },
        },
        required: ["dossier_id", "title", "severity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_document",
      description: "Initie une session de génération de document. Pour docs sensibles → demande de validation auto.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          doc_type: { type: "string" },
          domain: { type: "string" },
          params: { type: "object" },
        },
        required: ["dossier_id", "doc_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_validation",
      description: "Crée une demande de validation hiérarchique avant exécution d'une action engageante.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          action_type: { type: "string" },
          reason: { type: "string" },
          payload: { type: "object" },
        },
        required: ["dossier_id", "action_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_reminder",
      description: "Programme un rappel.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          title: { type: "string" },
          remind_at: { type: "string" },
          channel: { type: "string", enum: ["in_app", "email"] },
        },
        required: ["title", "remind_at"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Crée une tâche dans un dossier.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          title: { type: "string" },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
          due_date: { type: "string" },
        },
        required: ["dossier_id", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_deadline",
      description: "Crée une échéance.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          title: { type: "string" },
          due_date: { type: "string" },
        },
        required: ["dossier_id", "title", "due_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_dossier",
      description: "Recherche dans les dossiers du tenant par titre ou description.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_dossier",
      description: "Crée un nouveau dossier juridique pour le tenant.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string", description: "rh|commercial|societes|rgpd|fiscal|contentieux|administratif|general" },
          description: { type: "string" },
          client_id: { type: "string" },
          risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_workflow",
      description: "Instancie une procédure (workflow) depuis sa définition. Fournir definition_slug OU definition_id.",
      parameters: {
        type: "object",
        properties: {
          definition_id: { type: "string" },
          definition_slug: { type: "string" },
          title: { type: "string" },
          dossier_id: { type: "string" },
          client_id: { type: "string" },
          context: { type: "object" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_document",
      description: "Analyse un document (résumé, type, risques, clauses manquantes). Si dossier_id fourni, persiste les risques détectés.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string" },
          dossier_id: { type: "string" },
        },
        required: ["document_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_report",
      description: "Génère un rapport markdown synthétisant un dossier (timeline, risques, tâches, échéances).",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          report_type: { type: "string", description: "synthese|complet|risques" },
        },
        required: ["dossier_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_workflow",
      description: "Génère une nouvelle procédure (workflow) juridique à partir d'une demande en langage naturel, avec validation RAG + consensus + safety. Retourne un workflow_definition_id et un score de confiance. Utiliser uniquement si aucun workflow existant ne correspond.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Description en langage naturel de la procédure souhaitée" },
          domain: { type: "string", description: "rh|commercial|societes|rgpd|fiscal|contentieux|administratif" },
          dossier_id: { type: "string" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_workflow_step",
      description: "Exécute l'étape courante d'un workflow déjà instancié. Si l'étape est sensible, crée automatiquement une demande de validation et bloque. Sinon avance le workflow et calcule l'échéance légale (jours ouvrés/calendaires/mois, art. 642 CPC).",
      parameters: {
        type: "object",
        properties: {
          instance_id: { type: "string", description: "UUID workflow_instances" },
          step_index: { type: "number", description: "Index de l'étape courante (0-based)" },
          notes: { type: "string" },
        },
        required: ["instance_id", "step_index"],
      },
    },
  },
];

async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "search_law":
        return await searchLaw(String(args.query ?? ""), ctx);
      case "dossier_context":
        return await dossierContext(String(args.dossier_id ?? ""), ctx);
      case "identify_risk":
        return await identifyRisk(args as never, ctx);
      case "propose_document":
        return await proposeDocument(args as never, ctx);
      case "request_validation":
        return await requestValidation(args as never, ctx);
      case "schedule_reminder":
        return await scheduleReminder(args as never, ctx);
      case "create_task":
        return await createTask(args as never, ctx);
      case "create_deadline":
        return await createDeadline(args as never, ctx);
      case "search_dossier":
        return await searchDossier(args as never, ctx);
      case "create_dossier":
        return await createDossierTool(args as never, ctx);
      case "start_workflow":
        return await startWorkflowTool(args as never, ctx);
      case "analyze_document":
        return await analyzeDocumentTool(args as never, ctx);
      case "generate_report":
        return await generateReportTool(args as never, ctx);
      case "generate_workflow":
        return await generateWorkflowTool(args as never, ctx);
      case "run_workflow_step":
        return await runWorkflowStepTool(args as never, ctx);
      default:
        return { result: { error: "Unknown tool" }, succeeded: false };
    }
  } catch (e) {
    return {
      result: { error: (e as Error).message },
      succeeded: false,
      errorMessage: (e as Error).message,
    };
  }
}

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

    const apiKey = process.env.LOVABLE_API_KEY;
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

    // ÉTAPE 2-7 : boucle outils
    // Top 51-60 / sécurité : on enveloppe le message utilisateur dans un bloc
    // sanitisé pour neutraliser les tentatives de prompt-injection.
    const { sanitizePromptInput, PROMPT_INJECTION_GUARD } = await import(
      "@/server/_shared/prompt-sanitizer.server"
    );
    const safeMessage = sanitizePromptInput(data.message, { maxLength: 4000 });
    const userPreamble = data.dossier_id
      ? `[Contexte dossier actif : ${data.dossier_id}]\nClassification préalable : intent=${classification.intent}, domaine=${classification.domain}, sujet="${classification.topic}".\n\nDemande utilisateur :\n${safeMessage}`
      : `Classification préalable : intent=${classification.intent}, domaine=${classification.domain}, sujet="${classification.topic}".\n\nDemande utilisateur :\n${safeMessage}`;

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${PROMPT_INJECTION_GUARD}` },
      { role: "user", content: userPreamble },
    ];
    const trace: AgentRunOutput["trace"] = [];

    let answer = "";
    let refused = false;
    let refusalReason: string | null = null;

    const chatModel = await resolveChatModel(tenantId);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await llmFetch(`${AI_GATEWAY}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: chatModel,
          messages,
          tools: TOOLS,
          tool_choice: "auto",
        }),
      });
      if (!res.ok) {
        if (res.status === 429) throw new Error("Trop de requêtes IA");
        if (res.status === 402) throw new Error("Crédits IA épuisés");
        throw new Error(`Erreur IA ${res.status}`);
      }
      const json = await res.json();
      const msg = json.choices?.[0]?.message;
      if (!msg) throw new Error("Réponse IA invalide");
      messages.push(msg);

      const toolCalls = msg.tool_calls as
        | Array<{ id: string; function: { name: string; arguments: string } }>
        | undefined;

      if (!toolCalls || toolCalls.length === 0) {
        answer = (msg.content ?? "").toString();
        break;
      }

      // A7 : exécuter tous les tool calls indépendants en parallèle.
      // L'ordre des `messages` (role:"tool") est conservé via Promise.all + map.
      const results = await Promise.all(
        toolCalls.map(async (call) => {
          const t0 = Date.now();
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            /* noop */
          }
          try {
            const outcome = await runTool(call.function.name, args, ctx);
            return { call, args, outcome, duration: Date.now() - t0, error: null as string | null };
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : "tool failed";
            return {
              call,
              args,
              outcome: { result: { error: errorMessage }, succeeded: false, errorMessage },
              duration: Date.now() - t0,
              error: errorMessage,
            };
          }
        }),
      );

      // Trace DB en batch
      const traceRows = results.map((r) => ({
        agent_run_id: runId,
        tenant_id: tenantId,
        tool_name: r.call.function.name,
        args: r.args,
        result: r.outcome.result ?? {},
        is_sensitive: (r.outcome as { isSensitive?: boolean }).isSensitive ?? false,
        validation_request_id: (r.outcome as { validationRequestId?: string | null }).validationRequestId ?? null,
        succeeded: r.outcome.succeeded,
        error_message: r.outcome.errorMessage ?? null,
        duration_ms: r.duration,
      }));
      if (traceRows.length > 0) {
        await sb.from("agent_tool_runs").insert(traceRows);
      }

      for (const r of results) {
        trace.push({
          tool: r.call.function.name,
          args: r.args,
          sensitive: (r.outcome as { isSensitive?: boolean }).isSensitive ?? false,
          succeeded: r.outcome.succeeded,
          validation_request_id: (r.outcome as { validationRequestId?: string | null }).validationRequestId ?? null,
        });
        messages.push({
          role: "tool",
          tool_call_id: r.call.id,
          content: JSON.stringify(r.outcome.result).slice(0, 8000),
        });
      }
    }

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

    return {
      run_id: runId,
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
