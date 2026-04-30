// Server functions pour la matrice rôles/permissions multi-profils.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "./_shared/tenant.server";

export type AppRole =
  | "user"
  | "manager"
  | "admin"
  | "super_admin"
  | "admin_tenant"
  | "juriste"
  | "avocat_partenaire"
  | "cabinet_comptable_admin"
  | "collaborateur_cabinet"
  | "rh"
  | "comptable"
  | "daf"
  | "dirigeant"
  | "operationnel_terrain";

export type UserAccess = {
  tenantId: string;
  roles: AppRole[];
  permissions: string[];
  isSuperAdmin: boolean;
  isTenantAdmin: boolean;
};

/**
 * Charge le contexte d'accès de l'utilisateur courant :
 * tous ses rôles dans le tenant + permissions agrégées via la matrice.
 */
export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { user: { id: string } };
    const userId = ctx.user.id;
    const tenantId = await getTenantId(userId);

    const { data: rolesRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);

    const roles = ((rolesRows ?? []) as { role: AppRole }[]).map((r) => r.role);

    // Permissions agrégées : matrice role_permissions globale (tenant_id IS NULL)
    // + overrides spécifiques au tenant.
    const { data: permRows } = await supabaseAdmin
      .from("role_permissions")
      .select("permission_key, role, tenant_id")
      .in("role", roles.length > 0 ? roles : ["user"])
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);

    const permissions = Array.from(
      new Set(
        ((permRows ?? []) as { permission_key: string }[]).map(
          (p) => p.permission_key,
        ),
      ),
    );

    const access: UserAccess = {
      tenantId,
      roles,
      permissions,
      isSuperAdmin: roles.includes("super_admin"),
      isTenantAdmin:
        roles.includes("admin") ||
        roles.includes("admin_tenant") ||
        roles.includes("super_admin"),
    };
    return access;
  });
