// Résolution du modèle LLM par tenant (R2).
// Le défaut est un modèle STABLE (pas une preview) pour éviter les changements
// de comportement silencieux. Un tenant peut surcharger via `tenants.chat_model`.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const DEFAULT_CHAT_MODEL = "google/gemini-2.5-flash";
export const DEFAULT_EMBED_MODEL = "openai/text-embedding-3-small";

const cache = new Map<string, { model: string; at: number }>();
const TTL_MS = 60_000;

export async function resolveChatModel(tenantId: string | null | undefined): Promise<string> {
  if (!tenantId) return DEFAULT_CHAT_MODEL;
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.model;
  try {
    const { data } = await supabaseAdmin
      .from("tenants")
      .select("chat_model")
      .eq("id", tenantId)
      .maybeSingle();
    const model = (data as { chat_model?: string | null } | null)?.chat_model || DEFAULT_CHAT_MODEL;
    cache.set(tenantId, { model, at: Date.now() });
    return model;
  } catch {
    return DEFAULT_CHAT_MODEL;
  }
}
