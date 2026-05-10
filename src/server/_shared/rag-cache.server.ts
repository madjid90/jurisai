// LOT 11 — Cache de réponses RAG (Postgres, scope tenant).
//
// Évite de relancer un pipeline RAG complet (embeddings + hybrid_search + LLM)
// pour une question identique d'un même tenant pendant TTL_SECONDS.
// Stockage Postgres car Redis n'est pas dispo dans ce stack.

import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TTL_SECONDS = 15 * 60; // 15 minutes

export type CachedRagPayload = {
  answer: string;
  citations: unknown;
  model?: string;
  meta?: Record<string, unknown>;
};

function hashKey(tenantId: string, question: string, extra?: Record<string, unknown>): string {
  const norm = question.trim().toLowerCase().replace(/\s+/g, " ");
  const payload = JSON.stringify({ t: tenantId, q: norm, e: extra ?? null });
  return createHash("sha256").update(payload).digest("hex");
}

export async function getCachedRag(
  tenantId: string,
  question: string,
  extra?: Record<string, unknown>,
): Promise<CachedRagPayload | null> {
  if (!tenantId || !question) return null;
  const key = hashKey(tenantId, question, extra);
  const { data } = await supabaseAdmin
    .from("rag_response_cache")
    .select("payload, expires_at")
    .eq("cache_key", key)
    .maybeSingle();
  if (!data) return null;
  const exp = (data as { expires_at?: string }).expires_at;
  if (exp && new Date(exp).getTime() < Date.now()) return null;
  // bump hit count async (best-effort)
  void supabaseAdmin
    .rpc("increment_rag_cache_hit", { _key: key })
    .then(() => void 0, () => void 0);
  return ((data as unknown) as { payload: CachedRagPayload }).payload ?? null;
}

export async function setCachedRag(
  tenantId: string,
  question: string,
  payload: CachedRagPayload,
  extra?: Record<string, unknown>,
): Promise<void> {
  if (!tenantId || !question) return;
  const key = hashKey(tenantId, question, extra);
  const expires = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
  await supabaseAdmin
    .from("rag_response_cache")
    .upsert(
      [
        {
          cache_key: key,
          tenant_id: tenantId,
          question: question.slice(0, 1000),
          payload: payload as never,
          expires_at: expires,
        },
      ],
      { onConflict: "cache_key" },
    );
}
