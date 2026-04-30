// Catalogue des 13 risques contractuels typés détectés par l'IA
// (utilisé côté UI pour libellés/icônes et côté serveur pour normalisation).

export type ContractRiskKey =
  | "auto_renewal"
  | "missed_notice_period"
  | "excessive_penalties"
  | "unbalanced_clauses"
  | "missing_termination"
  | "missing_jurisdiction"
  | "rgpd_non_compliance"
  | "missing_confidentiality"
  | "indefinite_duration"
  | "unilateral_modification"
  | "exclusivity_too_broad"
  | "non_compete_invalid"
  | "late_payment_no_clause";

export type ContractRiskDef = {
  key: ContractRiskKey;
  label: string;
  defaultSeverity: "medium" | "high" | "critical";
  category:
    | "renouvellement"
    | "delai"
    | "financier"
    | "clause"
    | "conformite"
    | "juridiction"
    | "rh";
  description: string;
};

export const CONTRACT_RISKS: Record<ContractRiskKey, ContractRiskDef> = {
  auto_renewal: {
    key: "auto_renewal",
    label: "Reconduction tacite",
    defaultSeverity: "high",
    category: "renouvellement",
    description: "Le contrat se renouvelle automatiquement sans alerte préalable.",
  },
  missed_notice_period: {
    key: "missed_notice_period",
    label: "Préavis court ou flou",
    defaultSeverity: "high",
    category: "delai",
    description: "Délai de préavis insuffisant ou imprécis pour résilier sans pénalité.",
  },
  excessive_penalties: {
    key: "excessive_penalties",
    label: "Pénalités excessives",
    defaultSeverity: "high",
    category: "financier",
    description: "Clause pénale potentiellement disproportionnée (art. 1231-5 C. civ.).",
  },
  unbalanced_clauses: {
    key: "unbalanced_clauses",
    label: "Clauses déséquilibrées",
    defaultSeverity: "medium",
    category: "clause",
    description: "Déséquilibre significatif entre les parties (art. L.442-1 C. com. / L.212-1 C. conso).",
  },
  missing_termination: {
    key: "missing_termination",
    label: "Pas de clause de résiliation",
    defaultSeverity: "high",
    category: "clause",
    description: "Aucune clause de résiliation anticipée prévue.",
  },
  missing_jurisdiction: {
    key: "missing_jurisdiction",
    label: "Juridiction / loi applicable manquante",
    defaultSeverity: "medium",
    category: "juridiction",
    description: "Le contrat ne précise ni la loi ni le tribunal compétent.",
  },
  rgpd_non_compliance: {
    key: "rgpd_non_compliance",
    label: "Non-conformité RGPD",
    defaultSeverity: "high",
    category: "conformite",
    description: "Traitement de données sans clauses RGPD (art. 28 RGPD pour sous-traitance).",
  },
  missing_confidentiality: {
    key: "missing_confidentiality",
    label: "Pas de clause de confidentialité",
    defaultSeverity: "medium",
    category: "clause",
    description: "Absence de clause de confidentialité / NDA.",
  },
  indefinite_duration: {
    key: "indefinite_duration",
    label: "Durée indéterminée non bornée",
    defaultSeverity: "medium",
    category: "delai",
    description: "Engagement sans terme et sans modalité de sortie claire.",
  },
  unilateral_modification: {
    key: "unilateral_modification",
    label: "Modification unilatérale",
    defaultSeverity: "high",
    category: "clause",
    description: "Une partie peut modifier unilatéralement le contrat — risque de nullité.",
  },
  exclusivity_too_broad: {
    key: "exclusivity_too_broad",
    label: "Exclusivité trop large",
    defaultSeverity: "medium",
    category: "clause",
    description: "Exclusivité sans limite géographique, temporelle ou matérielle.",
  },
  non_compete_invalid: {
    key: "non_compete_invalid",
    label: "Clause de non-concurrence non valable",
    defaultSeverity: "high",
    category: "rh",
    description: "Manque limite, contrepartie financière, durée ou zone (Cass. soc. 10/07/2002).",
  },
  late_payment_no_clause: {
    key: "late_payment_no_clause",
    label: "Pénalités de retard non précisées",
    defaultSeverity: "medium",
    category: "financier",
    description: "Aucune mention des pénalités de retard ou indemnité forfaitaire (art. L.441-10 C. com.).",
  },
};

export const CONTRACT_RISK_KEYS = Object.keys(CONTRACT_RISKS) as ContractRiskKey[];

export type DetectedDate = {
  key: string; // ex: "end_date", "notice_deadline", "trial_end", "payment_due"
  label: string;
  iso_date: string; // YYYY-MM-DD
  type:
    | "signature"
    | "effective"
    | "trial_end"
    | "renewal"
    | "notice"
    | "end"
    | "payment"
    | "deadline"
    | "other";
  importance: "low" | "medium" | "high" | "critical";
  description?: string;
  excerpt?: string;
};

export function isValidIsoDate(s: string | undefined | null): boolean {
  if (!s || typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}
