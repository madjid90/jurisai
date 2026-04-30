// Helper rate limiting basé sur la fonction Postgres `check_rate_limit`.
// À appeler en TÊTE de chaque server function sensible (agent, génération,
// analyse, exports, contact-rgpd, etc.).
//
// Ne JAMAIS bloquer pour autre chose qu'un dépassement explicite — un échec
// d'appel RPC ne doit pas casser le métier.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RateLimitResult = {
  allowed: boolean;
  currentCount: number;
  resetAt: string | null;
};

export async function enforceRateLimit(
  userId: string,
  endpoint: string,
  maxPerMinute = 10,
): Promise<RateLimitResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin as any).rpc("check_rate_limit", {
      p_user_id: userId,
      p_endpoint: endpoint,
      p_max_per_minute: maxPerMinute,
    });

    if (error || !data || (Array.isArray(data) && data.length === 0)) {
      return { allowed: true, currentCount: 0, resetAt: null };
    }

    const row = Array.isArray(data) ? data[0] : data;
    const result: RateLimitResult = {
      allowed: Boolean(row.allowed),
      currentCount: Number(row.current_count ?? 0),
      resetAt: row.reset_at ?? null,
    };

    if (!result.allowed) {
      const retry = result.resetAt ? ` Réessayez après ${new Date(result.resetAt).toLocaleTimeString("fr-FR")}.` : "";
      throw new Error(`Trop de requêtes (${result.currentCount}/${maxPerMinute} par minute sur "${endpoint}").${retry}`);
    }

    return result;
  } catch (e) {
    // Si l'erreur vient de notre `throw` ci-dessus → propagation
    if (e instanceof Error && e.message.startsWith("Trop de requêtes")) throw e;
    // Sinon (RPC down, etc.) → on laisse passer (fail-open)
    console.warn("[rate-limit] check failed, fail-open:", e);
    return { allowed: true, currentCount: 0, resetAt: null };
  }
}
