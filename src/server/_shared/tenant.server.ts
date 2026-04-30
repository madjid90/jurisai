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
  // PostgREST may transiently fail with "Could not query the database for the
  // schema cache. Retrying." right after a migration. Retry up to 3 times with
  // a small backoff before surfacing the error to the user.
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();

    if (!error) {
      const tenantId = (data as ProfileRow | null)?.tenant_id;
      if (!tenantId) {
        throw new Error("Vous devez d'abord compléter l'onboarding");
      }
      return tenantId;
    }
    lastError = error.message;
    const transient = /schema cache|temporarily|timeout|ECONN/i.test(error.message);
    if (!transient) break;
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
  }
  throw new Error(`Profil introuvable: ${lastError ?? "unknown error"}`);
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
