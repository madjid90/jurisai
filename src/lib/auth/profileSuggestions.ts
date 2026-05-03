// Suggestions d'actions adaptées au profil utilisateur.
// Affichées sur la home (DashboardPage) en complément des chips génériques.
// Filtrées par rôle ET par permission disponible.

import type { UserAccess } from "@/server/permissions.functions";
import { hasPermission } from "@/lib/auth/useAccess";

export type ProfileSuggestion = {
  key: string;
  label: string;
  /** Texte injecté dans le prompt de l'agent (si action conversationnelle). */
  prompt?: string;
  /** Route directe (si action navigation). */
  to?: string;
  /** Permission requise (l'utilisateur doit l'avoir). */
  perm?: string;
  /** Rôles ciblés — au moins un doit matcher (ou aucun = universel). */
  roles?: string[];
};

const ALL: ProfileSuggestion[] = [
  // RH
  { key: "rh.rupture", label: "Préparer une rupture conventionnelle", prompt: "Prépare une rupture conventionnelle pour ", roles: ["rh"], perm: "workflows.run" },
  { key: "rh.embauche", label: "Lancer une embauche", prompt: "Démarre une embauche : ", roles: ["rh"], perm: "workflows.run" },
  { key: "rh.disciplinaire", label: "Procédure disciplinaire", prompt: "Lance une procédure disciplinaire pour ", roles: ["rh", "juriste"], perm: "workflows.run" },

  // Juriste
  { key: "jur.contrat", label: "Rédiger un contrat commercial", prompt: "Rédige un contrat commercial pour ", roles: ["juriste", "avocat_partenaire"], perm: "documents.generate" },
  { key: "jur.cgv", label: "Mettre à jour les CGV", prompt: "Mets à jour les CGV de ", roles: ["juriste"], perm: "documents.generate" },
  { key: "jur.contentieux", label: "Ouvrir un contentieux", prompt: "Ouvre un dossier contentieux : ", roles: ["juriste", "avocat_partenaire"], perm: "dossiers.create" },

  // DAF / comptable
  { key: "daf.relance", label: "Relancer un impayé", prompt: "Prépare une relance pour impayé : ", roles: ["daf", "comptable", "cabinet_comptable_admin"], perm: "documents.generate" },
  { key: "daf.veille", label: "Veille fiscale du jour", to: "/veille", roles: ["daf", "comptable", "cabinet_comptable_admin", "collaborateur_cabinet"], perm: "veille.view" },

  // Dirigeant
  { key: "dir.synthese", label: "Synthèse hebdo des risques", prompt: "Donne-moi la synthèse hebdomadaire des risques juridiques", roles: ["dirigeant", "admin_tenant"], perm: "ia.ask" },
  { key: "dir.dossiers", label: "Dossiers à valider", to: "/dossiers", roles: ["dirigeant", "admin_tenant"], perm: "dossiers.view" },

  // Cabinet comptable
  { key: "cab.client", label: "Ouvrir un dossier client", prompt: "Ouvre un nouveau dossier client : ", roles: ["cabinet_comptable_admin", "collaborateur_cabinet"], perm: "clients.manage" },

  // Opérationnel terrain
  { key: "ter.scan", label: "Scanner un document", to: "/scan", roles: ["operationnel_terrain"], perm: "documents.upload" },
  { key: "ter.demander", label: "Poser une question simple", prompt: "", roles: ["operationnel_terrain"], perm: "ia.ask" },
];

/** Retourne jusqu'à `limit` suggestions adaptées au profil de l'utilisateur. */
export function getProfileSuggestions(access: UserAccess, limit = 5): ProfileSuggestion[] {
  const roles = new Set(access.roles);
  const matches = ALL.filter((s) => {
    if (s.perm && !hasPermission(access, s.perm)) return false;
    if (s.roles && s.roles.length > 0) {
      return s.roles.some((r) => roles.has(r as never));
    }
    return true;
  });
  return matches.slice(0, limit);
}
