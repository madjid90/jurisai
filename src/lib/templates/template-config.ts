// Métadonnées partagées (client + server) pour la configuration des modèles de documents.

export type DocumentScenario = "no_upload" | "from_upload" | "from_dossier";

export type PrefillSource =
  | "dossier"
  | "client"
  | "employee"
  | "contract"
  | "ocr"
  | "history"
  | "ai";

export type FieldType =
  | "text"
  | "textarea"
  | "date"
  | "number"
  | "select"
  | "multi_select"
  | "boolean"
  | "file"
  | "user"
  | "client"
  | "case";

export type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  hint?: string;
  prefill_from?: PrefillSource[];
};

export type TemplateConfig = {
  requires_upload: boolean;
  upload_optional: boolean;
  requires_form: boolean;
  requires_rag: boolean;
  requires_validation: boolean;
  archive_to_case: boolean;
  can_create_reminder: boolean;
  reminder_days_default: number | null;
  output_formats: string[]; // pdf | docx | html | email
  prefill_sources: PrefillSource[];
  guidance: string | null;
  validation_threshold: "auto" | "always" | "never";
};

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  requires_upload: false,
  upload_optional: false,
  requires_form: true,
  requires_rag: false,
  requires_validation: false,
  archive_to_case: true,
  can_create_reminder: false,
  reminder_days_default: null,
  output_formats: ["pdf", "docx"],
  prefill_sources: [],
  guidance: null,
  validation_threshold: "auto",
};

/**
 * Détermine si la génération doit déclencher une demande de validation.
 * - threshold = "always" → toujours
 * - threshold = "never"  → jamais
 * - threshold = "auto"   → si risk élevé/critique OU requires_validation
 */
export function shouldRequestValidation(
  riskLevel: string,
  cfg: Pick<TemplateConfig, "requires_validation" | "validation_threshold">,
): boolean {
  if (cfg.validation_threshold === "always") return true;
  if (cfg.validation_threshold === "never") return false;
  if (cfg.requires_validation) return true;
  return riskLevel === "high" || riskLevel === "critical";
}

/**
 * Choisit le scénario par défaut selon la config.
 */
export function defaultScenario(cfg: Pick<TemplateConfig, "requires_upload" | "upload_optional">): DocumentScenario {
  if (cfg.requires_upload) return "from_upload";
  if (cfg.upload_optional) return "no_upload"; // user peut bascule
  return "no_upload";
}

export const PREFILL_SOURCE_LABELS: Record<PrefillSource, string> = {
  dossier: "Dossier",
  client: "Client",
  employee: "Salarié",
  contract: "Contrat",
  ocr: "OCR du document",
  history: "Historique",
  ai: "Suggestion IA",
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Texte",
  textarea: "Texte long",
  date: "Date",
  number: "Nombre",
  select: "Choix unique",
  multi_select: "Choix multiple",
  boolean: "Oui/Non",
  file: "Fichier",
  user: "Utilisateur",
  client: "Client",
  case: "Dossier",
};
