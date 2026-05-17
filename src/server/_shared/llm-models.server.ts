// Résolution du modèle LLM par tenant (R2).
// Le défaut est un modèle STABLE (pas une preview) pour éviter les changements
// de comportement silencieux. Un tenant peut surcharger via `tenants.chat_model`.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Audit fix : "google/gemini-2.5-flash" est un model Lovable Gateway uniquement.
// Si AI_GATEWAY = api.openai.com/v1 (OpenAI direct) → 400 invalid model.
// gpt-4o-mini marche sur OpenAI direct ET sur Lovable Gateway (qui reroute).
export const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
export const DEFAULT_EMBED_MODEL = "text-embedding-3-small";

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
