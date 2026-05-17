// LOT 8 — Tests boucle agentique (LLM + tool calls).
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertCalls: unknown[][] = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (rows: unknown[]) => {
        insertCalls.push(rows as unknown[]);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  },
}));

const llmFetchMock = vi.fn();
vi.mock("../llm-fetch.server", () => ({
  llmFetch: (...a: unknown[]) => llmFetchMock(...a),
}));

const routeToolMock = vi.fn();
vi.mock("../agent-tool-router.server", () => ({
  routeTool: (...a: unknown[]) => routeToolMock(...a),
}));

import { runAgentLoop } from "../agent-loop.server";

const baseCtx = {
  userId: "u1",
  tenantId: "t1",
  idcc: null,
  apiKey: "k",
  sources: [],
};

function llmResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  insertCalls.length = 0;
  llmFetchMock.mockReset();
  routeToolMock.mockReset();
});

describe("runAgentLoop", () => {
  it("retourne directement la réponse si pas de tool_calls", async () => {
    llmFetchMock.mockResolvedValueOnce(
      llmResponse({ choices: [{ message: { role: "assistant", content: "Réponse finale" } }] }),
    );
    const r = await runAgentLoop({
      apiKey: "k",
      model: "google/gemini-2.5-flash",
      tools: [],
      initialMessages: [{ role: "user", content: "ping" }],
      ctx: baseCtx,
      runId: "run1",
      tenantId: "t1",
    });
    expect(r.answer).toBe("Réponse finale");
    expect(r.trace).toEqual([]);
    expect(llmFetchMock).toHaveBeenCalledTimes(1);
  });

  it("exécute les tool_calls en parallèle puis renvoie la réponse finale", async () => {
    // Round 1 : LLM demande 2 outils
    llmFetchMock.mockResolvedValueOnce(
      llmResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "c1", function: { name: "search_law", arguments: '{"query":"L1232-1"}' } },
                { id: "c2", function: { name: "dossier_context", arguments: '{"dossier_id":"d1"}' } },
              ],
            },
          },
        ],
      }),
    );
    // Round 2 : LLM finalise
    llmFetchMock.mockResolvedValueOnce(
      llmResponse({ choices: [{ message: { role: "assistant", content: "Voici la réponse" } }] }),
    );
    routeToolMock.mockImplementation(async (name: string) => ({
      result: { tool: name },
      succeeded: true,
      isSensitive: name === "propose_document",
    }));

    const r = await runAgentLoop({
      apiKey: "k",
      model: "m",
      tools: [],
      initialMessages: [{ role: "user", content: "?" }],
      ctx: baseCtx,
      runId: "run1",
      tenantId: "t1",
    });

    expect(r.answer).toBe("Voici la réponse");
    expect(r.trace).toHaveLength(2);
    expect(r.trace.map((t) => t.tool).sort()).toEqual(["dossier_context", "search_law"]);
    expect(routeToolMock).toHaveBeenCalledTimes(2);
    // Batch insert dans agent_tool_runs : un seul appel avec 2 lignes
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toHaveLength(2);
  });

  it("propage l'erreur 429 en message lisible", async () => {
    llmFetchMock.mockResolvedValueOnce({ ok: false, status: 429 } as Response);
    await expect(
      runAgentLoop({
        apiKey: "k",
        model: "m",
        tools: [],
        initialMessages: [{ role: "user", content: "x" }],
        ctx: baseCtx,
        runId: "r",
        tenantId: "t1",
      }),
    ).rejects.toThrow(/Trop de requêtes/);
  });

  it("propage l'erreur 402 (crédits épuisés)", async () => {
    llmFetchMock.mockResolvedValueOnce({ ok: false, status: 402 } as Response);
    await expect(
      runAgentLoop({
        apiKey: "k",
        model: "m",
        tools: [],
        initialMessages: [],
        ctx: baseCtx,
        runId: "r",
        tenantId: "t1",
      }),
    ).rejects.toThrow(/Crédits IA/);
  });

  it("respecte maxRounds et retourne answer vide si jamais de réponse finale", async () => {
    llmFetchMock.mockResolvedValue(
      llmResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "c", function: { name: "search_law", arguments: "{}" } }],
            },
          },
        ],
      }),
    );
    routeToolMock.mockResolvedValue({ result: {}, succeeded: true });
    const r = await runAgentLoop({
      apiKey: "k",
      model: "m",
      tools: [],
      initialMessages: [],
      ctx: baseCtx,
      runId: "r",
      tenantId: "t1",
      maxRounds: 2,
    });
    // maxRounds=2 + 1 appel synthesis fallback (AL-3) qui force tool_choice="none" pour
    // récupérer une réponse texte → 3 llmFetch attendus
    expect(llmFetchMock).toHaveBeenCalledTimes(3);
    expect(routeToolMock).toHaveBeenCalledTimes(2);
  });
});
