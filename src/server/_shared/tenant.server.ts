// Helper centralisé multi-tenant.
// SOURCE DE VÉRITÉ unique pour résoudre le tenant_id d'un utilisateur.
//
// Règles :
//  - `getTenantId(userId)` : utilise supabaseAdmin (bypass RLS) — pour server functions internes.
//  - `requireAdmin(userId)` : vérifie que l'utilisateur est admin du tenant et le retourne.
//
// IMPORTANT : ne jamais réécrire localement getTenantId dans un *.functions.ts.
// Toute divergence est une régression et doit être corrigée ici.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ProfileRow = { tenant_id: string | null };

/**
 * Récupère le tenant_id de l'utilisateur via son profil.
 * Lève une erreur explicite si l'onboarding n'est pas complété.
 */
export async function getTenantId(userId: string): Promise<string> {
  // STRATÉGIE V2 : RPC SECURITY DEFINER en PREMIER.
  // Avant on essayait SELECT direct qui pouvait être bloqué par RLS (cas Lovable
  // Cloud où SUPABASE_SERVICE_ROLE_KEY peut être en réalité anon key).
  // La RPC get_user_tenant_id est SECURITY DEFINER, bypass RLS, marche toujours
  // tant que le user existe dans profiles.
  //
  // En cas d'échec total (réseau, RPC supprimée), fallback SELECT puis throw.

  let rpcLastErr: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabaseAdmin as any;
      const { data: rpcData, error: rpcErr } = await sb.rpc("get_user_tenant_id", { _user_id: userId });

      if (rpcErr) {
        rpcLastErr = rpcErr.message;
        const transient = /schema cache|temporarily|timeout|ECONN|503/i.test(rpcErr.message);
        if (!transient) break; // erreur permanente (RPC manquante, perm refusée) → on sort retry
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        continue;
      }

      if (rpcData) return rpcData as string;

      // RPC OK mais retourne null → user vraiment sans tenant
      throw new Error("Vous devez d'abord compléter l'onboarding");
    } catch (e) {
      if (e instanceof Error && e.message === "Vous devez d'abord compléter l'onboarding") throw e;
      rpcLastErr = e instanceof Error ? e.message : String(e);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }

  // Fallback ultime : SELECT direct (au cas où la RPC serait drop)
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (!error && data) {
    const tenantId = (data as ProfileRow | null)?.tenant_id;
    if (tenantId) return tenantId;
    throw new Error("Vous devez d'abord compléter l'onboarding");
  }

  throw new Error(
    `Profil introuvable: rpc_err=${rpcLastErr ?? "none"} select_err=${error?.message ?? "data_null"}`,
  );
}

/**
 * Vérifie que l'utilisateur est admin de son tenant. Retourne le tenant_id.
 */
export async function requireAdmin(userId: string): Promise<string> {
  const tenantId = await getTenantId(userId);
  const { data: role } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("role", "admin")
    .maybeSingle();
  if (!role) throw new Error("Forbidden — admin only");
  return tenantId;
}
