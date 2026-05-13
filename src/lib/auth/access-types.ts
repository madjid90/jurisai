// Types client-safe pour l'accès utilisateur.
// Sortis de src/server/permissions.functions.ts pour éviter que l'import
// statique côté client (via AuthProvider → useAccess) ne déclenche
// l'import-protection (`**/server/**` interdit côté client).

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
