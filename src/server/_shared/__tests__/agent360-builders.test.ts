// Tests unitaires pour les fonctions déterministes du Sprint J4 :
//  - verifyWorkflowSteps
//  - verifyDocumentGrounding
//  - isSensitiveAction

import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({}), rpc: () => Promise.resolve({ data: null, error: null }) },
}));
vi.mock("./error-monitor.server", () => ({ captureServerError: vi.fn() }));
vi.mock("./timeline.server", () => ({ logTimelineEvent: vi.fn() }));

import {
  verifyWorkflowSteps,
  verifyDocumentGrounding,
  isSensitiveAction,
} from "../agent360-builders.server";
import type { LegalProcedure, DocumentGrammar } from "../lre-schemas.server";

function makeProc(overrides: Partial<LegalProcedure> = {}): LegalProcedure {
  return {
    procedure_slug: "test",
    title: "Test",
    domain: "droit_social",
    risk_level: "medium",
    requires_human_review: false,
    required_information: [],
    legal_refs: [],
    steps: [
      {
        index: 0,
        title: "S1",
        description: "",
        step_type: "action",
        legal_ref: null,
        source_id: null,
        verbatim: null,
        delay_days_before: null,
        delay_days_after: null,
        delay_source: null,
        documents_to_generate: [],
        requires_validation: false,
        validation_roles: [],
        risks: [],
      },
    ],
    documents: [],
    deadlines: [],
    validation_rules: [],
    warnings: [],
    ...overrides,
  };
}

describe("verifyWorkflowSteps", () => {
  it("ok=true sur procédure simple cohérente", () => {
    const v = verifyWorkflowSteps(makeProc());
    expect(v.ok).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it("erreur si 0 step", () => {
    const v = verifyWorkflowSteps(makeProc({ steps: [] }));
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/Aucune étape/);
  });

  it("warning si délai sans source", () => {
    const v = verifyWorkflowSteps(makeProc({
      steps: [{
        ...makeProc().steps[0],
        delay_days_after: 5,
        delay_source: null,
      }],
    }));
    expect(v.warnings.some((w) => w.includes("sans source"))).toBe(true);
  });

  it("erreur si deadline.from_step pointe step inexistant", () => {
    const v = verifyWorkflowSteps(makeProc({
      deadlines: [{ label: "x", from_step: 42, days: 1, source: "L1", source_id: null, is_imperative: true }],
    }));
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("from_step=42"))).toBe(true);
  });

  it("erreur si document.step_index pointe step inexistant", () => {
    const v = verifyWorkflowSteps(makeProc({
      documents: [{
        doc_type: "x",
        template_slug: null,
        step_index: 99,
        required_mentions: [],
        validation_required: false,
      }],
    }));
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("step_index=99"))).toBe(true);
  });
});

describe("verifyDocumentGrounding", () => {
  function makeGrammar(overrides: Partial<DocumentGrammar> = {}): DocumentGrammar {
    return {
      document_type: "test",
      domain: "droit_social",
      template_slug: null,
      required_fields: [],
      required_legal_mentions: [],
      forbidden_phrases: [],
      validation_required: true,
      output_formats: ["pdf", "docx"],
      ...overrides,
    };
  }

  it("ok=true sans mention obligatoire ni phrase interdite", () => {
    const v = verifyDocumentGrounding("<html>contenu libre</html>", makeGrammar());
    expect(v.ok).toBe(true);
    expect(v.grounding_health).toBe(1);
  });

  it("erreur si mention obligatoire absente du HTML", () => {
    const v = verifyDocumentGrounding(
      "<html>contenu sans rien de spécial</html>",
      makeGrammar({
        required_legal_mentions: [{
          mention: "possibilité d'être assisté par un conseiller",
          legal_ref: "L1232-4",
          source_id: 1,
          verbatim_extrait: "Le salarié peut se faire assister",
          position_hint: null,
        }],
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.mentions_missing).toHaveLength(1);
    expect(v.errors[0]).toMatch(/Mention obligatoire absente/);
  });

  it("ok=true si la mention est présente (insensible casse + accents)", () => {
    const v = verifyDocumentGrounding(
      "<p>Le salarié dispose de la possibilité d'être assisté par un conseiller du salarié.</p>",
      makeGrammar({
        required_legal_mentions: [{
          mention: "possibilité d'être assisté par un conseiller",
          legal_ref: "L1232-4",
          source_id: 1,
          verbatim_extrait: "x",
          position_hint: null,
        }],
      }),
    );
    expect(v.ok).toBe(true);
    expect(v.mentions_present).toHaveLength(1);
  });

  it("erreur si phrase interdite trouvée", () => {
    const v = verifyDocumentGrounding(
      "<p>Ce contrat est définitif et sans recours possible.</p>",
      makeGrammar({
        forbidden_phrases: [{
          phrase: "sans recours possible",
          reason: "Toute clause supprimant le droit au recours est nulle",
          legal_ref: null,
        }],
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.forbidden_found).toContain("sans recours possible");
  });
});

describe("isSensitiveAction (liste codée en dur)", () => {
  it.each([
    "licenciement",
    "licenciement_personnel",
    "rupture_conventionnelle",
    "mise_en_demeure",
    "transaction",
    "sanction_disciplinaire",
    "notification_violation_donnees_cnil",
  ])("classe '%s' comme sensible", (key) => {
    expect(isSensitiveAction(key)).toBe(true);
  });

  it.each([
    "create_task",
    "search_law",
    "view_dossier",
    "lancer_question",
  ])("classe '%s' comme NON sensible", (key) => {
    expect(isSensitiveAction(key)).toBe(false);
  });

  it("est insensible à la casse et aux espaces", () => {
    expect(isSensitiveAction("  LICENCIEMENT  ")).toBe(true);
    expect(isSensitiveAction("Mise_En_Demeure")).toBe(true);
  });
});
