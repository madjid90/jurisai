// Catalogue des types et statuts métier d'un dossier JurisAI.
// Source de vérité unique pour les écrans Dossiers / Dossier360 / Agent.

export type CaseType =
  // Anciens (rétro-compat)
  | "licenciement"
  | "rupture-conventionnelle"
  | "contentieux"
  | "discipline"
  | "contrat"
  | "autre"
  // Nouveaux (transverses)
  | "rh_salarie"
  | "contrat_commercial"
  | "litige_client"
  | "fournisseur"
  | "societe"
  | "rgpd_conformite"
  | "facture_impayee"
  | "veille_juridique"
  | "procedure_interne"
  | "site_operationnel";

export type CaseStatus =
  // Anciens (rétro-compat)
  | "open"
  | "in_progress"
  | "closed"
  // Nouveaux (workflow métier)
  | "nouveau"
  | "en_analyse"
  | "action_requise"
  | "en_attente_validation"
  | "en_cours"
  | "a_surveiller"
  | "termine"
  | "archive";

export const CASE_TYPE_OPTIONS: Array<{
  value: CaseType;
  label: string;
  domain: "rh" | "commercial" | "societes" | "rgpd" | "fiscal" | "contentieux" | "general";
}> = [
  { value: "rh_salarie", label: "RH / Salarié", domain: "rh" },
  { value: "contrat_commercial", label: "Contrat commercial", domain: "commercial" },
  { value: "litige_client", label: "Litige client", domain: "contentieux" },
  { value: "fournisseur", label: "Fournisseur", domain: "commercial" },
  { value: "societe", label: "Société (gouvernance / vie sociale)", domain: "societes" },
  { value: "rgpd_conformite", label: "RGPD / Conformité", domain: "rgpd" },
  { value: "facture_impayee", label: "Facture impayée", domain: "commercial" },
  { value: "veille_juridique", label: "Veille juridique", domain: "general" },
  { value: "procedure_interne", label: "Procédure interne", domain: "general" },
  { value: "site_operationnel", label: "Site opérationnel", domain: "general" },
  // Anciens (toujours sélectionnables si dossier hérité)
  { value: "contrat", label: "Contrat (générique)", domain: "commercial" },
  { value: "licenciement", label: "Licenciement", domain: "rh" },
  { value: "rupture-conventionnelle", label: "Rupture conventionnelle", domain: "rh" },
  { value: "contentieux", label: "Contentieux (générique)", domain: "contentieux" },
  { value: "discipline", label: "Discipline", domain: "rh" },
  { value: "autre", label: "Autre", domain: "general" },
];

export const CASE_STATUS_OPTIONS: Array<{
  value: CaseStatus;
  label: string;
  tone: "neutral" | "info" | "warn" | "danger" | "success" | "muted";
}> = [
  { value: "nouveau", label: "Nouveau", tone: "info" },
  { value: "en_analyse", label: "En analyse", tone: "info" },
  { value: "action_requise", label: "Action requise", tone: "danger" },
  { value: "en_attente_validation", label: "En attente de validation", tone: "warn" },
  { value: "en_cours", label: "En cours", tone: "neutral" },
  { value: "a_surveiller", label: "À surveiller", tone: "warn" },
  { value: "termine", label: "Terminé", tone: "success" },
  { value: "archive", label: "Archivé", tone: "muted" },
  // Anciens
  { value: "open", label: "Ouvert (legacy)", tone: "info" },
  { value: "in_progress", label: "En cours (legacy)", tone: "neutral" },
  { value: "closed", label: "Clôturé (legacy)", tone: "success" },
];

const STATUS_BY_VALUE = new Map(CASE_STATUS_OPTIONS.map((s) => [s.value, s]));
const TYPE_BY_VALUE = new Map(CASE_TYPE_OPTIONS.map((t) => [t.value, t]));

export function getCaseStatusMeta(v: string) {
  return STATUS_BY_VALUE.get(v as CaseStatus) ?? { value: v, label: v, tone: "neutral" as const };
}

export function getCaseTypeMeta(v: string) {
  return TYPE_BY_VALUE.get(v as CaseType) ?? { value: v, label: v, domain: "general" as const };
}

export const STATUS_TONE_CLASS: Record<"neutral" | "info" | "warn" | "danger" | "success" | "muted", string> = {
  neutral: "bg-secondary text-foreground",
  info: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  warn: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  danger: "bg-destructive/10 text-destructive border-destructive/40",
  success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  muted: "bg-muted text-muted-foreground",
};
