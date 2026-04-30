// Catalogue centralisé des 13 rôles JurisAI (P7).
// Source de vérité unique pour le front (sélecteurs, badges) et la validation serveur.
//
// Le rôle `super_admin` est réservé à l'admin plateforme et ne peut PAS être attribué via l'UI.
// Le rôle `admin_tenant` est un alias historique conservé pour compatibilité ; on l'expose
// avec un libellé clair mais on encourage l'usage de `admin`.

import {
  Crown,
  Shield,
  UserCog,
  User as UserIcon,
  HardHat,
  Calculator,
  Briefcase,
  Building2,
  Scale,
  Gavel,
  Library,
  Users as UsersIcon,
  Heart,
  type LucideIcon,
} from "lucide-react";

export type AppRole =
  | "admin"
  | "manager"
  | "user"
  | "super_admin"
  | "operationnel_terrain"
  | "comptable"
  | "daf"
  | "dirigeant"
  | "juriste"
  | "avocat_partenaire"
  | "cabinet_comptable_admin"
  | "collaborateur_cabinet"
  | "admin_tenant"
  | "rh";

export type RoleMeta = {
  value: AppRole;
  label: string;
  description: string;
  icon: LucideIcon;
  // Couleur via tokens sémantiques (jamais en dur)
  tone: "primary" | "accent" | "muted" | "destructive";
  assignable: boolean; // false = ne s'attribue pas via l'UI standard
  group: "core" | "metier" | "cabinet" | "system";
};

export const ROLES: RoleMeta[] = [
  // Core (les 3 historiques — on garde)
  { value: "admin", label: "Administrateur", description: "Accès complet à l'organisation", icon: Crown, tone: "primary", assignable: true, group: "core" },
  { value: "manager", label: "Manager", description: "Gère équipe & dossiers, peut inviter", icon: UserCog, tone: "accent", assignable: true, group: "core" },
  { value: "user", label: "Utilisateur", description: "Accès standard aux dossiers", icon: UserIcon, tone: "muted", assignable: true, group: "core" },

  // Métier
  { value: "dirigeant", label: "Dirigeant", description: "Vision globale, signe les actes", icon: Briefcase, tone: "primary", assignable: true, group: "metier" },
  { value: "daf", label: "DAF", description: "Finance, contrats, contentieux financiers", icon: Building2, tone: "accent", assignable: true, group: "metier" },
  { value: "rh", label: "RH", description: "Gestion sociale, contrats de travail, CSE", icon: Heart, tone: "accent", assignable: true, group: "metier" },
  { value: "juriste", label: "Juriste interne", description: "Pilote dossiers juridiques & analyses", icon: Scale, tone: "primary", assignable: true, group: "metier" },
  { value: "comptable", label: "Comptable", description: "Lecture des dossiers fiscaux & sociaux", icon: Calculator, tone: "muted", assignable: true, group: "metier" },
  { value: "operationnel_terrain", label: "Opérationnel terrain", description: "Saisie & remontée d'informations", icon: HardHat, tone: "muted", assignable: true, group: "metier" },

  // Cabinet (partenaires externes)
  { value: "avocat_partenaire", label: "Avocat partenaire", description: "Accès dossiers délégués", icon: Gavel, tone: "accent", assignable: true, group: "cabinet" },
  { value: "cabinet_comptable_admin", label: "Cabinet comptable (admin)", description: "Admin d'un cabinet comptable rattaché", icon: Library, tone: "accent", assignable: true, group: "cabinet" },
  { value: "collaborateur_cabinet", label: "Collaborateur cabinet", description: "Collaborateur d'un cabinet rattaché", icon: UsersIcon, tone: "muted", assignable: true, group: "cabinet" },

  // System (non assignables via l'UI)
  { value: "admin_tenant", label: "Admin tenant", description: "Alias historique (équivalent admin)", icon: Shield, tone: "primary", assignable: false, group: "system" },
  { value: "super_admin", label: "Super admin", description: "Plateforme — réservé Lovable", icon: Shield, tone: "destructive", assignable: false, group: "system" },
];

export const ROLE_MAP: Record<AppRole, RoleMeta> = ROLES.reduce(
  (acc, r) => {
    acc[r.value] = r;
    return acc;
  },
  {} as Record<AppRole, RoleMeta>,
);

export const ASSIGNABLE_ROLES = ROLES.filter((r) => r.assignable);

// Hiérarchie : pour résoudre le rôle "principal" si un user a plusieurs rôles.
const PRIORITY: AppRole[] = [
  "super_admin",
  "admin",
  "admin_tenant",
  "dirigeant",
  "daf",
  "manager",
  "juriste",
  "rh",
  "avocat_partenaire",
  "cabinet_comptable_admin",
  "comptable",
  "collaborateur_cabinet",
  "operationnel_terrain",
  "user",
];

export function pickHighestRole(roles: AppRole[]): AppRole {
  if (roles.length === 0) return "user";
  for (const r of PRIORITY) if (roles.includes(r)) return r;
  return roles[0]!;
}

export function roleLabel(role: string): string {
  return ROLE_MAP[role as AppRole]?.label ?? role;
}

export function roleIcon(role: string): LucideIcon {
  return ROLE_MAP[role as AppRole]?.icon ?? UserIcon;
}

export function roleToneClass(role: string): string {
  const tone = ROLE_MAP[role as AppRole]?.tone ?? "muted";
  switch (tone) {
    case "primary":
      return "bg-primary/10 text-primary";
    case "accent":
      return "bg-accent/10 text-accent";
    case "destructive":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-secondary text-foreground/70";
  }
}
