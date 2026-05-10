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
      // Fail-CLOSED : si on ne peut pas vérifier, on bloque.
      console.error("[rate-limit] check_rate_limit indisponible — fail-closed:", error?.message);
      throw new Error("Service de limitation indisponible. Réessayez dans quelques instants.");
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
    // Toute erreur (dépassement OU RPC down) → propagation : fail-closed
    if (e instanceof Error) throw e;
    throw new Error("Service de limitation indisponible.");
  }
}
