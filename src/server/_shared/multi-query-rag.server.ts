// ============================================================================
// Multi-Query RAG : recherche RAG enrichie pour génération workflow
// ============================================================================
// 1. Génère 5 reformulations via LLM
// 2. Search chacune en parallèle (hybrid_search)
// 3. Fusionne par RRF (Reciprocal Rank Fusion)
// 4. Retourne top N sources uniques
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embedText, toPgVector } from "./embeddings.server";
import { sanitizePromptInput } from "./prompt-sanitizer.server";

import { AI_GATEWAY, LLM_TEMPERATURES, LLM_MAX_TOKENS } from "./constants.server";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

export type RagSource = {
  source_id: string;
  chunk_id: string;
  title: string;
  reference: string | null;
  url: string | null;
  source_type: string;
  excerpt: string;
  authority: number;
  rank_score?: number;
};

async function expandQuery(query: string, apiKey: string): Promise<string[]> {
  // S-CRITIQUE : sanitize l'input user avant injection dans le prompt LLM
  const safeQuery = sanitizePromptInput(query, { label: "USER_QUERY", maxLength: 500 });
  const prompt = `Tu es expert en droit français. Reformule cette demande en 5 variantes
qui pourraient matcher différents articles de loi, conventions collectives, jurisprudence.
Garde le sens, varie le vocabulaire juridique.

Demande : "${safeQuery}"

Retourne UNIQUEMENT un JSON {"variants": ["v1","v2","v3","v4","v5"]}`;

  try {
    const res = await fetch(`${AI_GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: LLM_TEMPERATURES.expansion,
        max_tokens: LLM_MAX_TOKENS.expansion,
      }),
    });
    if (!res.ok) return [query];
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    const variants = Array.isArray(parsed)
      ? parsed
      : (parsed.variants ?? parsed.queries ?? []);
    return [query, ...variants.slice(0, 5)].filter(
      (s: unknown): s is string => typeof s === "string" && s.trim().length > 0,
    );
  } catch {
    return [query];
  }
}

type HybridRow = {
  chunk_id: string;
  source_id: string;
  content: string;
  heading: string | null;
  source_title: string;
  source_type: string;
  reference_code: string | null;
  official_url: string | null;
  score: number;
};

function mapRow(r: HybridRow, authority = 50): RagSource {
  return {
    source_id: r.source_id,
    chunk_id: r.chunk_id,
    title: r.source_title ?? r.heading ?? "Source",
    reference: r.reference_code ?? null,
    url: r.official_url ?? null,
    source_type: r.source_type ?? "autre",
    excerpt: (r.content ?? "").slice(0, 600),
    authority,
  };
}

export async function multiQueryRag(
  query: string,
  options: {
    topN?: number;
    idcc?: string | null;
    apiKey: string;
  },
): Promise<{ sources: RagSource[]; variants: string[] }> {
  const { topN = 30, idcc = null, apiKey } = options;

  const variants = await expandQuery(query, apiKey);

  const allResults = await Promise.all(
    variants.map(async (q) => {
      try {
        const emb = await embedText(q);
        if (!emb) return [] as HybridRow[];
        const { data, error } = await db.rpc("hybrid_search", {
          query_text: q,
          query_embedding: toPgVector(emb),
          match_count: 15,
          idcc_filter: idcc,
        });
        if (error) return [] as HybridRow[];
        return (data ?? []) as HybridRow[];
      } catch {
        return [] as HybridRow[];
      }
    }),
  );

  // RRF fusion
  const k = 60;
  const fusionScores = new Map<string, { row: HybridRow; score: number }>();

  for (const queryResults of allResults) {
    queryResults.forEach((row, rank) => {
      const id = row.chunk_id;
      const rrf = 1 / (k + rank);
      const existing = fusionScores.get(id);
      if (existing) {
        existing.score += rrf;
      } else {
        fusionScores.set(id, { row, score: rrf });
      }
    });
  }

  const sorted = Array.from(fusionScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((entry) => ({ ...mapRow(entry.row), rank_score: entry.score }));

  return { sources: sorted, variants };
}
