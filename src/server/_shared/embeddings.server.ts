// Helper centralisé d'embeddings (Lovable AI Gateway).
// Toute opération qui doit produire un vecteur 1536 (text-embedding-3-small)
// passe par ici pour garantir l'unicité du modèle et du format.

import { AI_GATEWAY } from "./constants.server";
const EMBED_MODEL = "openai/text-embedding-3-small";

export async function embedText(input: string): Promise<number[] | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  const trimmed = input.trim().slice(0, 8000);
  if (!trimmed) return null;
  try {
    const res = await fetch(`${AI_GATEWAY}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: trimmed }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/** Convertit un vecteur JS en littéral Postgres `[v1,v2,...]` pour pgvector. */
export function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}
