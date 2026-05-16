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
import { AGENT_TOOLS, AGENT_SYSTEM_PROMPT } from "@/server/_shared/agent-tools-config.server";

const MAX_ROUNDS = 6;

// System prompt et outils sont désormais partagés via agent-tools-config.server.ts
// Alias locaux pour compatibilité du code existant
const SYSTEM_PROMPT = AGENT_SYSTEM_PROMPT;

const TOOLS = AGENT_TOOLS;


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

