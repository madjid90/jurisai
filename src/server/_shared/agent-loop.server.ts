// Boucle agentique principale (LLM + tool calls). Extrait de agent.functions.ts pour
// permettre la réutilisation (tests, replays, agents alternatifs).
//
// Responsabilités :
//   - dialogue itératif avec le LLM (max N rounds)
//   - exécution parallèle des tool_calls via routeTool
//   - persistence batch dans agent_tool_runs
//   - construction de la trace (côté caller)

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { llmFetch } from "./llm-fetch.server";
import type { AgentCtx, ToolOutcome } from "./agent-tools.server";
import { routeTool } from "./agent-tool-router.server";
import { AI_GATEWAY, LLM_TEMPERATURES, LLM_MAX_TOKENS } from "./constants.server";

export type AgentLoopTrace = {
  tool: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
  sensitive: boolean;
  succeeded: boolean;
  validation_request_id: string | null;
};

type RunLoopParams = {
  apiKey: string;
  model: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialMessages: Array<Record<string, unknown>>;
  ctx: AgentCtx;
  runId: string;
  tenantId: string;
  maxRounds?: number;
};

export type AgentLoopResult = {
  answer: string;
  trace: AgentLoopTrace[];
};

export async function runAgentLoop(p: RunLoopParams): Promise<AgentLoopResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const messages = [...p.initialMessages];
  const trace: AgentLoopTrace[] = [];
  let answer = "";

  for (let round = 0; round < (p.maxRounds ?? 6); round++) {
    const res = await llmFetch(`${AI_GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: p.model,
        temperature: LLM_TEMPERATURES.chat,
        max_tokens: LLM_MAX_TOKENS.chat,
        messages,
        tools: p.tools,
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

    const results = await Promise.all(
      toolCalls.map(async (call) => {
        const t0 = Date.now();
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* noop */ }
        const outcome: ToolOutcome = await routeTool(call.function.name, args, p.ctx);
        return { call, args, outcome, duration: Date.now() - t0 };
      }),
    );

    const traceRows = results.map((r) => ({
      agent_run_id: p.runId,
      tenant_id: p.tenantId,
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
      try { await sb.from("agent_tool_runs").insert(traceRows); } catch { /* noop */ }
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

  return { answer, trace };
}
