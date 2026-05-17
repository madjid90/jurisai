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
  // Audit fix : fail-OPEN si la RPC est indisponible (permissions Lovable, etc.).
  // Avant : fail-CLOSED bloquait TOUT appel à executeAgentRun / compareContractsServerFn
  // dès que check_rate_limit ne répondait pas → produit inutilisable.
  // La protection rate-limit est utile mais pas critique : on log et on autorise.
  let data: unknown = null;
  let error: { message?: string } | null = null;
  try {
    const res = await supabaseAdmin.rpc("check_rate_limit", {
      p_user_id: userId,
      p_endpoint: endpoint,
      p_max_per_minute: maxPerMinute,
    });
    data = res.data;
    error = res.error;
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    console.warn(`[rate-limit] check_rate_limit indisponible (fail-open) sur ${endpoint}:`, error?.message ?? "no data");
    // Retourne un résultat permissif au lieu de throw
    return { allowed: true, currentCount: 0, resetAt: null };
  }

  const row = Array.isArray(data) ? (data[0] as Record<string, unknown>) : (data as Record<string, unknown>);
  const result: RateLimitResult = {
    allowed: Boolean(row.allowed),
    currentCount: Number(row.current_count ?? 0),
    resetAt: (row.reset_at as string | null) ?? null,
  };

  if (!result.allowed) {
    const retry = result.resetAt ? ` Réessayez après ${new Date(result.resetAt).toLocaleTimeString("fr-FR")}.` : "";
    throw new Error(`Trop de requêtes (${result.currentCount}/${maxPerMinute} par minute sur "${endpoint}").${retry}`);
  }

  return result;
}
