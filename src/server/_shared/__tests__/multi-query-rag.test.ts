// LOT 8 — Tests RAG multi-query (RRF fusion + déduplication).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../embeddings.server", () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  toPgVector: (v: number[]) => `[${v.join(",")}]`,
}));

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));

const fetchMock = vi.fn();
const origFetch = globalThis.fetch;

beforeEach(() => {
  rpcMock.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

import { afterEach } from "vitest";
import { multiQueryRag } from "../multi-query-rag.server";

function row(chunkId: string, sourceId = "s1") {
  return {
    chunk_id: chunkId,
    source_id: sourceId,
    content: `contenu ${chunkId}`,
    heading: null,
    source_title: `Source ${sourceId}`,
    source_type: "code",
    reference_code: chunkId,
    official_url: null,
    score: 0.9,
  };
}

describe("multiQueryRag", () => {
  it("fusionne les résultats par RRF et déduplique par chunk_id", async () => {
    // expandQuery → 3 variantes (donc 4 queries au total avec l'originale)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ variants: ["v1", "v2", "v3"] }) } }],
      }),
    });
    // RPC : chunk "A" présent partout (rang 0) → score RRF élevé
    //       chunk "B" seulement dans 1 query
    rpcMock.mockResolvedValue({
      data: [row("A"), row("B")],
      error: null,
    });

    const r = await multiQueryRag("licenciement", { apiKey: "k", topN: 5 });
    // 4 variantes au total
    expect(r.variants.length).toBe(4);
    // Dédupliqué : 2 chunks uniques
    expect(r.sources).toHaveLength(2);
    // A doit être premier (présent dans toutes les queries → meilleur RRF)
    expect(r.sources[0].chunk_id).toBe("A");
    expect(r.sources[0].rank_score).toBeGreaterThan(r.sources[1].rank_score!);
  });

  it("fallback sur la query originale si expandQuery échoue", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    rpcMock.mockResolvedValue({ data: [row("X")], error: null });
    const r = await multiQueryRag("question", { apiKey: "k" });
    expect(r.variants).toEqual(["question"]);
    expect(r.sources).toHaveLength(1);
  });

  it("retourne liste vide si toutes les RPC échouent", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await multiQueryRag("x", { apiKey: "k" });
    expect(r.sources).toEqual([]);
  });

  it("propage idcc dans le filtre RPC", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    rpcMock.mockResolvedValue({ data: [], error: null });
    await multiQueryRag("x", { apiKey: "k", idcc: "1486" });
    expect(rpcMock).toHaveBeenCalled();
    const callArgs = rpcMock.mock.calls[0][1] as { idcc_filter: string | null };
    expect(callArgs.idcc_filter).toBe("1486");
  });
});
