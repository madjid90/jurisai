// Shared utility: génère des embeddings 1536-dim.
// Préfère OpenAI direct (text-embedding-3-small) si OPENAI_API_KEY présent,
// sinon fallback Lovable AI Gateway.

const OPENAI_URL = "https://api.openai.com/v1/embeddings";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
const OPENAI_MODEL = "text-embedding-3-small"; // 1536 dims, ~$0.02/1M tokens
const GATEWAY_MODEL = "openai/text-embedding-3-small";

export async function embedTexts(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  // Préférence : OpenAI direct si clé dispo
  if (openaiKey) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: OPENAI_MODEL, input: inputs }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI embedding ${res.status}: ${txt.slice(0, 300)}`);
    }
    const json = await res.json();
    return (json.data ?? []).map((d: { embedding: number[] }) => d.embedding);
  }

  // Fallback Lovable Gateway
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: GATEWAY_MODEL, input: inputs }),
  });
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 404 && txt.includes("route_not_found")) {
      console.warn(
        "[embeddings] Gateway embeddings indisponible et OPENAI_API_KEY absent — ingestion sans vecteurs.",
      );
      return new Array(inputs.length) as number[][];
    }
    throw new Error(`Gateway embedding ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.data ?? []).map((d: { embedding: number[] }) => d.embedding);
}

/**
 * Naive chunker by paragraphs/headings, target ~800 tokens (~3200 chars).
 * Falls back to hard split if a paragraph is too long.
 */
export function chunkText(
  text: string,
  opts: { targetChars?: number; overlapChars?: number } = {},
): Array<{ heading: string | null; content: string }> {
  const target = opts.targetChars ?? 3200;
  const overlap = opts.overlapChars ?? 300;

  // Split on blank lines
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Array<{ heading: string | null; content: string }> = [];
  let buffer = "";
  let currentHeading: string | null = null;

  const isHeading = (p: string) =>
    /^#+\s/.test(p) || /^Article\s+[A-Z]?\d+/.test(p) || p.length < 80 && /^[A-Z0-9].*[^.]$/.test(p);

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) chunks.push({ heading: currentHeading, content: trimmed });
    buffer = "";
  };

  for (const p of paragraphs) {
    if (isHeading(p) && buffer.length > 0) {
      flush();
      currentHeading = p.replace(/^#+\s*/, "").slice(0, 200);
      continue;
    }
    if (isHeading(p)) {
      currentHeading = p.replace(/^#+\s*/, "").slice(0, 200);
      continue;
    }

    if (buffer.length + p.length + 2 > target) {
      flush();
      // overlap: take tail of last chunk
      const last = chunks[chunks.length - 1];
      if (last && overlap > 0) {
        buffer = last.content.slice(-overlap) + "\n\n";
      }
    }
    buffer += (buffer ? "\n\n" : "") + p;
  }
  flush();

  // Hard split chunks that are still too long
  const final: Array<{ heading: string | null; content: string }> = [];
  for (const c of chunks) {
    if (c.content.length <= target * 1.5) {
      final.push(c);
    } else {
      for (let i = 0; i < c.content.length; i += target) {
        final.push({
          heading: c.heading,
          content: c.content.slice(i, i + target),
        });
      }
    }
  }
  return final;
}
