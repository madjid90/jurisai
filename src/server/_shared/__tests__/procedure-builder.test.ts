// Tests unitaires pour verifyProcedureGrounding (J3).
// Fonction purement déterministe — pas de mock LLM nécessaire.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({}), rpc: () => Promise.resolve({ data: [], error: null }) },
}));
vi.mock("./constants.server", () => ({ AI_GATEWAY: "x", LLM_API_KEY: "x", LLM_TEMPERATURES: { classification: 0 } }));
vi.mock("./llm-models.server", () => ({ resolveChatModel: () => Promise.resolve("m") }));
vi.mock("./llm-breaker.server", () => ({ withBreaker: (_m: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("./error-monitor.server", () => ({ captureServerError: vi.fn() }));

import { verifyProcedureGrounding } from "../procedure-builder.server";
import type { LegalProcedure, StratifiedRetrieval, RetrievedSource } from "../lre-schemas.server";

function makeSource(n: number, content: string): RetrievedSource {
  return {
    n,
    chunk_id: `${n}0000000-0000-0000-0000-000000000000`,
    source_id: `${n}1111111-0000-0000-0000-000000000000`,
    title: `Source ${n}`,
    reference: `Art. L${1000 + n}`,
    url: null,
    source_type: "code_article",
    lane: "legislation",
    content,
    excerpt: content.slice(0, 700),
    legal_date: null,
    score: 0.8,
  };
}

function makeRetrieval(sources: RetrievedSource[]): StratifiedRetrieval {
  return {
    legislation: sources,
    convention: [],
    jurisprudence: [],
    total: sources.length,
    date_at_filter: null,
    idcc_filter: null,
  };
}

function baseProcedure(overrides: Partial<LegalProcedure> = {}): LegalProcedure {
  return {
    procedure_slug: "test_procedure",
    title: "Test",
    domain: "droit_social",
    risk_level: "medium",
    requires_human_review: false,
    required_information: [],
    legal_refs: [],
    steps: [
      {
        index: 0,
        title: "Étape 1",
        description: "d",
        step_type: "document",
        legal_ref: "L1232-2",
        source_id: 1,
        verbatim: "extrait test",
        delay_days_before: null,
        delay_days_after: 5,
        delay_source: "L1232-2",
        documents_to_generate: ["convocation-entretien-prealable"],
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

describe("verifyProcedureGrounding", () => {
  it("ok=true quand toutes les étapes pointent une source valide avec verbatim correct", () => {
    const src = makeSource(1, "Le texte officiel contient cet extrait test ici.");
    const proc = baseProcedure();
    const v = verifyProcedureGrounding(proc, makeRetrieval([src]), ["convocation-entretien-prealable"]);
    expect(v.ok).toBe(true);
    expect(v.steps_grounded).toBe(1);
    expect(v.grounding_health).toBe(1);
    expect(v.errors).toHaveLength(0);
  });

  it("erreur si source_id inexistant", () => {
    const src = makeSource(1, "Texte");
    const proc = baseProcedure({
      steps: [{ ...baseProcedure().steps[0], source_id: 99, verbatim: "x" }],
    });
    const v = verifyProcedureGrounding(proc, makeRetrieval([src]), []);
    expect(v.ok).toBe(false);
    expect(v.unknown_source_ids).toContain(99);
    expect(v.errors[0]).toMatch(/source_id 99 inexistant/);
  });

  it("warning si verbatim non présent dans content de la source", () => {
    const src = makeSource(1, "Texte officiel rien d'autre");
    const proc = baseProcedure({
      steps: [{ ...baseProcedure().steps[0], verbatim: "Citation hallucinée jamais vue" }],
    });
    const v = verifyProcedureGrounding(proc, makeRetrieval([src]), []);
    expect(v.warnings.some((w) => w.includes("verbatim non trouvé"))).toBe(true);
  });

  it("ok=true même sans source pour un step type=action", () => {
    const src = makeSource(1, "Texte");
    const proc = baseProcedure({
      steps: [{
        ...baseProcedure().steps[0],
        step_type: "action",
        legal_ref: null,
        source_id: null,
        verbatim: null,
      }],
    });
    const v = verifyProcedureGrounding(proc, makeRetrieval([src]), []);
    expect(v.ok).toBe(true);
    expect(v.steps_grounded).toBe(1);
  });

  it("warning pour template_slug inconnu", () => {
    const src = makeSource(1, "extrait test");
    const proc = baseProcedure({
      documents: [{
        doc_type: "convocation",
        template_slug: "template-inexistant",
        step_index: 0,
        required_mentions: [],
        validation_required: true,
      }],
    });
    const v = verifyProcedureGrounding(proc, makeRetrieval([src]), ["autre-template"]);
    expect(v.missing_template_slugs).toContain("template-inexistant");
    expect(v.warnings.some((w) => w.includes("template_slug"))).toBe(true);
  });

  it("erreur si mention required pointe source_id inexistant", () => {
    const src = makeSource(1, "extrait test");
    const proc = baseProcedure({
      documents: [{
        doc_type: "convocation",
        template_slug: null,
        step_index: 0,
        required_mentions: [{ mention: "assistance", legal_ref: "L1232-4", source_id: 99, verbatim_extrait: "..." }],
        validation_required: true,
      }],
    });
    const v = verifyProcedureGrounding(proc, makeRetrieval([src]), []);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("source_id 99 inexistant"))).toBe(true);
  });

  it("warning pour deadline sans source", () => {
    const src = makeSource(1, "extrait test");
    const proc = baseProcedure({
      deadlines: [{ label: "Délai test", from_step: 0, days: 5, source: "", source_id: null, is_imperative: true }],
    });
    const v = verifyProcedureGrounding(proc, makeRetrieval([src]), []);
    expect(v.deadlines_without_source).toContain("Délai test");
    expect(v.warnings.some((w) => w.includes("Deadline"))).toBe(true);
  });

  it("ok=false si grounding_health < 0.7", () => {
    const src = makeSource(1, "Texte");
    const proc = baseProcedure({
      steps: [
        { ...baseProcedure().steps[0], source_id: 99 },  // unknown
        { ...baseProcedure().steps[0], index: 1, source_id: 88 }, // unknown
        { ...baseProcedure().steps[0], index: 2, source_id: 77 }, // unknown
        { ...baseProcedure().steps[0], index: 3, source_id: 1, verbatim: "Texte" }, // ok
      ],
    });
    const v = verifyProcedureGrounding(proc, makeRetrieval([src]), []);
    expect(v.ok).toBe(false);
    expect(v.grounding_health).toBeLessThan(0.7);
  });
});
