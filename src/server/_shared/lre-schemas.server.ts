// Schemas Zod pour le Legal Reasoning Engine (IRAC 3-pass + vérifications).
// Tous les outputs LLM passent par ces schemas pour validation stricte.
// Une seule source de vérité pour les types entre les 4 passes + persistence.

import { z } from "zod";

// ─── Référentiels (utilisés par plusieurs passes) ──────────────────────────

export const BRANCHE_DROIT = [
  "social",
  "commercial",
  "civil",
  "rgpd",
  "fiscal",
  "contentieux",
  "societes",
  "administratif",
  "penal_des_affaires",
  "immobilier",
  "famille",
  "international_prive",
] as const;

export const PARTIES = [
  "employeur",
  "salarie",
  "client_pro",
  "client_part",
  "fournisseur",
  "associe",
  "tiers",
  "administration",
] as const;

export const NIVEAU_NORMATIF = [
  "bloc_constitutionnel",
  "droit_ue_primaire",
  "droit_ue_derive",
  "conv_internationales",
  "loi_organique",
  "loi",
  "reglement",
  "convention_collective",
  "contrat",
  "jurisprudence",
] as const;

export const CONFIDENCE_LEVEL = ["haute", "moyenne", "faible"] as const;

export const SOURCE_TYPE_LANE = {
  legislation: [
    "code_article",
    "loi",
    "decret",
    "arrete",
    "loi_organique",
  ],
  convention: [
    "convention_article",
    "accord_branche",
    "accord_entreprise",
  ],
  jurisprudence: ["jurisprudence", "jurisprudence_admin"],
  doctrine: [
    "doctrine_fiscale",
    "fiche_service_public",
    "fiche_ministere_travail",
    "modele_courrier",
  ],
} as const;

// ─── Pass 1 — Qualification ────────────────────────────────────────────────

export const LegalQualificationSchema = z.object({
  issue: z.string().min(1).describe("Question de droit reformulée par un juriste"),
  branche: z.enum(BRANCHE_DROIT),
  sous_domaine: z.string().describe("Concept juridique précis, snake_case (ex: licenciement_disciplinaire)"),
  parties: z.array(z.enum(PARTIES)).min(1),
  faits_materiels: z.array(z.string()).describe("Faits structurés extraits de la question (séparés du droit)"),
  date_faits: z.string().nullable().describe("ISO date YYYY-MM-DD si extractible, sinon null"),
  idcc_hypothesis: z.string().nullable().describe("Code IDCC inféré (ex: 1486 pour Syntec) si social"),
  sous_questions_rag: z.array(z.string()).min(1).max(5).describe("1-5 sous-questions pour interroger le RAG"),
  articles_pivots: z.array(z.string()).default([]).describe("Articles du Code que le LLM pré-identifie déjà"),
  urgence: z.enum(["aucune", "delai_court", "delai_legal_strict"]).default("aucune"),
  complexity: z.enum(["low", "medium", "high"]).default("medium").describe("high → mode _deep recommandé"),
  missing_info: z.array(z.string()).default([]).describe("Infos manquantes pour qualifier précisément"),
  refuse: z.boolean().default(false).describe("true si question hors-droit / non éthique → STOP"),
  refuse_reason: z.string().nullable().default(null),
});

export type LegalQualification = z.infer<typeof LegalQualificationSchema>;

// ─── Pass 2 — Retrieval stratifié (output, pas LLM) ────────────────────────

export const RetrievedSourceSchema = z.object({
  n: z.number().int().positive().describe("Numéro de citation (1, 2, 3...)"),
  chunk_id: z.string().uuid(),
  source_id: z.string().uuid(),
  title: z.string(),
  reference: z.string().nullable(),
  url: z.string().nullable(),
  source_type: z.string(),
  lane: z.enum(["legislation", "convention", "jurisprudence", "doctrine"]),
  content: z.string().describe("Texte complet du chunk pour exact-match Pass 4"),
  excerpt: z.string().describe("Extrait court (≤700 chars) pour le prompt Pass 3"),
  legal_date: z.string().nullable(),
  score: z.number(),
});

export type RetrievedSource = z.infer<typeof RetrievedSourceSchema>;

export const StratifiedRetrievalSchema = z.object({
  legislation: z.array(RetrievedSourceSchema),
  convention: z.array(RetrievedSourceSchema),
  jurisprudence: z.array(RetrievedSourceSchema),
  total: z.number().int(),
  date_at_filter: z.string().nullable(),
  idcc_filter: z.string().nullable(),
});

export type StratifiedRetrieval = z.infer<typeof StratifiedRetrievalSchema>;

// ─── Pass 3 — Syllogisme IRAC ──────────────────────────────────────────────

export const CitationSchema = z.object({
  citation_verbatim: z.string().min(1).describe("Extrait EXACT de la source citée (vérifié par Pass 4)"),
  source_id: z.number().int().positive().describe("Numéro [source:N] correspondant"),
});

export const MajeureSchema = z.object({
  regle: z.string().describe("Règle de droit en 1 phrase claire"),
  citation_verbatim: z.string().min(1),
  source_id: z.number().int().positive(),
  niveau_normatif: z.enum(NIVEAU_NORMATIF),
});

export const ExceptionSchema = z.object({
  regle: z.string(),
  citation_verbatim: z.string().min(1),
  source_id: z.number().int().positive(),
});

export const PrincipeFaveurSchema = z.object({
  applicable: z.boolean(),
  niveau_retenu: z.enum(["legal", "conventionnel"]).nullable(),
  justification: z.string(),
});

export const SyllogismeSchema = z.object({
  majeure: MajeureSchema,
  mineure: z.object({
    faits_qualifies: z.string().describe("Reformulation des faits à la lumière du droit"),
  }),
  conclusion: z.object({
    application: z.string().describe("Comment la règle s'applique aux faits du cas"),
    principe_faveur: PrincipeFaveurSchema.nullable().describe("Évalué si branche=social et conv ≠ légal"),
    exceptions: z.array(ExceptionSchema).default([]),
  }),
  confidence_self: z.enum(CONFIDENCE_LEVEL).describe("Auto-évaluation du LLM, sera ajustée par Pass 4"),
  markdown_user: z.string().describe("Réponse formatée pour l'utilisateur (la seule chose qu'il voit)"),
  citations_secondaires: z.array(CitationSchema).default([]).describe("Citations dans markdown_user au-delà de la majeure"),
});

export type Syllogisme = z.infer<typeof SyllogismeSchema>;

// ─── Pass 4 — Vérifications algorithmiques ─────────────────────────────────

export const CitationCheckSchema = z.object({
  source_id: z.number(),
  level: z.enum(["exact", "normalized", "fuzzy", "fail"]),
  score: z.number().min(0).max(1),
  citation_excerpt: z.string().describe("Extrait de la citation vérifiée (≤100 chars)"),
});

export const VerificationChecksSchema = z.object({
  citation_health: z.number().min(0).max(1).describe("Moyenne pondérée des scores de citation"),
  citation_checks: z.array(CitationCheckSchema),
  temporal_violations: z.array(z.object({
    source_id: z.number(),
    legal_date: z.string(),
    date_faits: z.string(),
  })).describe("Sources citées dont legal_date > date_faits"),
  hierarchy_warnings: z.array(z.string()).describe("Ex: 'JP citée sans loi support'"),
  faveur_injected: z.boolean().describe("Vrai si Pass 4 a auto-ajouté principe_faveur manquant"),
  final_confidence: z.enum(CONFIDENCE_LEVEL).describe("Confidence dégradée par les checks"),
});

export type VerificationChecks = z.infer<typeof VerificationChecksSchema>;

// ─── Trace complète (persistence legal_reasoning_traces) ───────────────────

export const ReasoningTraceSchema = z.object({
  question: z.string(),
  qualification: LegalQualificationSchema,
  retrieved_sources: StratifiedRetrievalSchema,
  syllogisme: SyllogismeSchema,
  checks: VerificationChecksSchema,
  final_confidence: z.enum(CONFIDENCE_LEVEL),
  citation_health: z.number().min(0).max(1),
  mode: z.enum(["standard", "deep"]),
  total_llm_calls: z.number().int().min(0),
  total_latency_ms: z.number().int().min(0),
  total_tokens: z.number().int().min(0).nullable(),
  cost_eur: z.number().min(0).nullable(),
  refused: z.boolean(),
  refusal_reason: z.string().nullable(),
});

export type ReasoningTrace = z.infer<typeof ReasoningTraceSchema>;

// ─── Helpers de classification ─────────────────────────────────────────────

/** Classe un source_type dans une des 4 lanes du retrieval stratifié. */
export function classifyLane(sourceType: string | null): keyof typeof SOURCE_TYPE_LANE {
  if (!sourceType) return "doctrine";
  for (const [lane, types] of Object.entries(SOURCE_TYPE_LANE)) {
    if ((types as readonly string[]).includes(sourceType)) {
      return lane as keyof typeof SOURCE_TYPE_LANE;
    }
  }
  return "doctrine";
}

/** Map lane → niveau normatif (pour la majeure du syllogisme). */
export function laneToNiveau(lane: keyof typeof SOURCE_TYPE_LANE): typeof NIVEAU_NORMATIF[number] {
  switch (lane) {
    case "legislation": return "loi";
    case "convention": return "convention_collective";
    case "jurisprudence": return "jurisprudence";
    case "doctrine": return "jurisprudence"; // doctrine = source secondaire, mais pas dans niveau_normatif
  }
}
