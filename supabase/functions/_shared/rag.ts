// Shared RAG utilities: query sanitization, MMR re-ranking, structured logging.

/**
 * Sanitize a user query before embedding & sending to LLM.
 * - Trim & cap length (anti DoS)
 * - Strip prompt-injection patterns ("ignore previous instructions", role tags, etc.)
 * - Remove control chars
 */
export function sanitizeQuery(raw: string): string {
  if (!raw) return "";
  let q = String(raw).slice(0, 4000);

  // Strip control chars except \n \t
  q = q.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");

  // Neutralize obvious injection markers (case-insensitive)
  const patterns = [
    /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts?|rules?)/gi,
    /disregard\s+(the\s+)?(system|previous)/gi,
    /you\s+are\s+now\s+[a-z]+/gi,
    /\bsystem\s*:\s*/gi,
    /\bassistant\s*:\s*/gi,
    /<\/?\s*(system|assistant|user|sources)\s*>/gi,
    /\[\s*INST\s*\]/gi,
    /\[\/\s*INST\s*\]/gi,
  ];
  for (const p of patterns) q = q.replace(p, "[filtré]");

  return q.trim();
}

/**
 * Cosine similarity between two equal-length vectors.
 */
function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/**
 * Maximal Marginal Relevance — selects top-K chunks balancing
 * relevance to query and diversity vs. already-selected chunks.
 *
 * Falls back to score-ordering when embeddings are not provided.
 */
export interface MMRItem {
  score: number; // relevance to query (0..1)
  embedding?: number[]; // optional chunk embedding for diversity
}

export function mmrRerank<T extends MMRItem>(
  items: T[],
  k: number,
  lambda = 0.7,
): T[] {
  if (items.length <= k) return [...items];

  // Without embeddings → just take top-K by score
  const haveEmb = items.every((it) => Array.isArray(it.embedding) && it.embedding!.length > 0);
  if (!haveEmb) {
    return [...items].sort((a, b) => b.score - a.score).slice(0, k);
  }

  const selected: T[] = [];
  const remaining = [...items];

  // Pick highest-scored first
  remaining.sort((a, b) => b.score - a.score);
  selected.push(remaining.shift()!);

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let maxSim = 0;
      for (const sel of selected) {
        const sim = cosine(cand.embedding!, sel.embedding!);
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmr > bestVal) {
        bestVal = mmr;
        bestIdx = i;
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }
  return selected;
}

/**
 * Structured JSON logger — emits a single line of JSON to console
 * so it can be parsed by Supabase log explorer / external aggregator.
 */
export function logEvent(event: string, fields: Record<string, unknown>) {
  try {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...fields,
      }),
    );
  } catch {
    console.log(`[${event}]`, fields);
  }
}
