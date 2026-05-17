// Tests des schemas LRE : validation Zod stricte + helpers classification.
// Ces tests garantissent qu'un output LLM mal formé ne passe pas en silence.

import { describe, it, expect } from "vitest";
import {
  LegalQualificationSchema,
  SyllogismeSchema,
  StratifiedRetrievalSchema,
  ReasoningTraceSchema,
  classifyLane,
  laneToNiveau,
  BRANCHE_DROIT,
  NIVEAU_NORMATIF,
} from "../lre-schemas.server";

describe("LRE — LegalQualificationSchema (Pass 1)", () => {
  const validQualif = {
    issue: "Le licenciement est-il régulier ?",
    branche: "social" as const,
    sous_domaine: "licenciement_disciplinaire",
    parties: ["employeur", "salarie"] as const,
    faits_materiels: ["Notification sans convocation préalable"],
    date_faits: "2025-03-15",
    idcc_hypothesis: "1486",
    sous_questions_rag: ["procédure licenciement", "entretien préalable"],
    articles_pivots: ["L.1232-2 CT"],
    urgence: "delai_legal_strict" as const,
    complexity: "medium" as const,
    missing_info: [],
    refuse: false,
    refuse_reason: null,
  };

  it("valide une qualification correcte", () => {
    expect(() => LegalQualificationSchema.parse(validQualif)).not.toThrow();
  });

  it("rejette une branche invalide", () => {
    expect(() => LegalQualificationSchema.parse({ ...validQualif, branche: "inconnu" })).toThrow();
  });

  it("rejette parties vides", () => {
    expect(() => LegalQualificationSchema.parse({ ...validQualif, parties: [] })).toThrow();
  });

  it("rejette sous_questions_rag vide", () => {
    expect(() => LegalQualificationSchema.parse({ ...validQualif, sous_questions_rag: [] })).toThrow();
  });

  it("autorise date_faits=null (pas de date dans la question)", () => {
    expect(() => LegalQualificationSchema.parse({ ...validQualif, date_faits: null })).not.toThrow();
  });

  it("applique défaut complexity=medium si absent", () => {
    const { complexity, ...withoutComplexity } = validQualif;
    void complexity;
    const parsed = LegalQualificationSchema.parse(withoutComplexity);
    expect(parsed.complexity).toBe("medium");
  });

  it("refuse=true valide même sans autres champs (mais structure quand même requise)", () => {
    expect(() => LegalQualificationSchema.parse({ ...validQualif, refuse: true, refuse_reason: "Hors juridique" })).not.toThrow();
  });

  it("supporte les 12 branches de droit", () => {
    expect(BRANCHE_DROIT.length).toBe(12);
    for (const b of BRANCHE_DROIT) {
      expect(() => LegalQualificationSchema.parse({ ...validQualif, branche: b })).not.toThrow();
    }
  });
});

describe("LRE — SyllogismeSchema (Pass 3)", () => {
  const validSyllo = {
    majeure: {
      regle: "Tout licenciement doit être précédé d'un entretien préalable",
      citation_verbatim: "L'employeur qui envisage de licencier un salarié le convoque...",
      source_id: 1,
      niveau_normatif: "loi" as const,
    },
    mineure: { faits_qualifies: "L'employeur a notifié sans convocation" },
    conclusion: {
      application: "Le licenciement est irrégulier",
      principe_faveur: null,
      exceptions: [],
    },
    confidence_self: "haute" as const,
    markdown_user: "## Réponse...",
    citations_secondaires: [],
  };

  it("valide un syllogisme correct", () => {
    expect(() => SyllogismeSchema.parse(validSyllo)).not.toThrow();
  });

  it("rejette citation_verbatim vide (anti-hallucination)", () => {
    expect(() =>
      SyllogismeSchema.parse({
        ...validSyllo,
        majeure: { ...validSyllo.majeure, citation_verbatim: "" },
      }),
    ).toThrow();
  });

  it("rejette source_id=0 ou négatif", () => {
    expect(() =>
      SyllogismeSchema.parse({
        ...validSyllo,
        majeure: { ...validSyllo.majeure, source_id: 0 },
      }),
    ).toThrow();
  });

  it("supporte les 10 niveaux normatifs", () => {
    expect(NIVEAU_NORMATIF.length).toBe(10);
    for (const nv of NIVEAU_NORMATIF) {
      expect(() =>
        SyllogismeSchema.parse({ ...validSyllo, majeure: { ...validSyllo.majeure, niveau_normatif: nv } }),
      ).not.toThrow();
    }
  });

  it("principe_faveur peut être null OU objet structuré", () => {
    expect(() =>
      SyllogismeSchema.parse({
        ...validSyllo,
        conclusion: {
          ...validSyllo.conclusion,
          principe_faveur: { applicable: true, niveau_retenu: "conventionnel" as const, justification: "Plus favorable au salarié" },
        },
      }),
    ).not.toThrow();
  });
});

describe("LRE — StratifiedRetrievalSchema (Pass 2)", () => {
  it("valide un retrieval avec les 3 lanes vides", () => {
    expect(() =>
      StratifiedRetrievalSchema.parse({
        legislation: [],
        convention: [],
        jurisprudence: [],
        total: 0,
        date_at_filter: null,
        idcc_filter: null,
      }),
    ).not.toThrow();
  });
});

describe("LRE — helpers de classification", () => {
  it("classifyLane mappe correctement les source_type", () => {
    expect(classifyLane("code_article")).toBe("legislation");
    expect(classifyLane("loi")).toBe("legislation");
    expect(classifyLane("decret")).toBe("legislation");
    expect(classifyLane("convention_article")).toBe("convention");
    expect(classifyLane("accord_branche")).toBe("convention");
    expect(classifyLane("jurisprudence")).toBe("jurisprudence");
    expect(classifyLane("jurisprudence_admin")).toBe("jurisprudence");
    expect(classifyLane("fiche_service_public")).toBe("doctrine");
    expect(classifyLane(null)).toBe("doctrine");
    expect(classifyLane("inconnu")).toBe("doctrine");
  });

  it("laneToNiveau retourne le bon niveau normatif", () => {
    expect(laneToNiveau("legislation")).toBe("loi");
    expect(laneToNiveau("convention")).toBe("convention_collective");
    expect(laneToNiveau("jurisprudence")).toBe("jurisprudence");
  });
});

describe("LRE — ReasoningTraceSchema (persistence)", () => {
  it("rejette citation_health hors [0,1]", () => {
    const incomplete: Partial<unknown> = {
      question: "test",
      citation_health: 1.5, // > 1
    };
    expect(() => ReasoningTraceSchema.parse(incomplete)).toThrow();
  });

  it("rejette final_confidence invalide", () => {
    const incomplete = {
      final_confidence: "exceptionnelle", // pas dans CONFIDENCE_LEVEL
      citation_health: 0.5,
    };
    expect(() => ReasoningTraceSchema.parse(incomplete)).toThrow();
  });
});
