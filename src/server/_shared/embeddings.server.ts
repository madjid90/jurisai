// Compat shim — redirige vers llm-embeddings.server.ts (le module robuste
// avec retry/backoff) pour éviter la duplication. Les 4 fichiers qui importent
// `embedText` depuis ici obtiennent désormais la version avec retries.

import { embedText as robustEmbed, type EmbedResult } from "./llm-embeddings.server";

/**
 * Embed un texte via le module robuste (retry/backoff).
 * Signature simplifiée pour compat : renvoie number[] | null.
 */
export async function embedText(input: string): Promise<number[] | null> {
  const result: EmbedResult = await robustEmbed(input, { context: "embeddings-compat" });
  if (result.ok) return result.embedding;
  return null;
}

/** Convertit un vecteur JS en littéral Postgres `[v1,v2,...]` pour pgvector. */
export function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}
