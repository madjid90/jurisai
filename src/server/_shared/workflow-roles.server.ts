// Helper centralisé pour les rôles d'administration / validation.
// BUG-W4 : avant on avait `["admin", "manager"]` côté workflow-validation
// et `["admin", "admin_tenant", "super_admin"]` côté workflow-runtime.
// Désormais une seule source de vérité.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Rôles autorisés à valider une étape de workflow ou une action sensible. */
export const WORKFLOW_VALIDATOR_ROLES = [
  "admin",
  "admin_tenant",
  "manager",
  "super_admin",
] as const;

export type WorkflowValidatorRole = (typeof WORKFLOW_VALIDATOR_ROLES)[number];

/** Renvoie la liste (déduite) des user_id ayant un rôle validateur sur le tenant. */
export async function listTenantValidators(tenantId: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .in("role", WORKFLOW_VALIDATOR_ROLES as unknown as string[]);
  const ids = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  return Array.from(new Set(ids));
}

/** True si l'utilisateur a un rôle validateur sur le tenant. */
export async function userIsValidator(userId: string, tenantId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .in("role", WORKFLOW_VALIDATOR_ROLES as unknown as string[])
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}
