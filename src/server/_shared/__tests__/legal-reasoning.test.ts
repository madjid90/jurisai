// Tests unitaires pour le Legal Reasoning Engine (Sprint J2).
// On teste verifyCitations (purement déterministe, sans LLM, sans DB).
//
// Les autres fonctions (qualify, retrieve, syllogism) appellent LLM/RAG et sont
// testées par les tests E2E sur l'agent en prod.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock minimal pour pouvoir importer le module sans déclencher d'I/O
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

vi.mock("./constants.server", () => ({
  AI_GATEWAY: "https://example.test",
  LLM_API_KEY: "test",
  LLM_TEMPERATURES: { classification: 0.1 },
}));

vi.mock("./llm-models.server", () => ({
  resolveChatModel: () => Promise.resolve("gpt-4o-mini"),
}));

vi.mock("./llm-breaker.server", () => ({
  withBreaker: (_m: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("./prompt-sanitizer.server", () => ({
  sanitizePromptInput: (s: string) => s,
  PROMPT_INJECTION_GUARD: "",
}));

vi.mock("./error-monitor.server", () => ({
  captureServerError: vi.fn().mockResolvedValue(undefined),
}));

import { verifyCitations } from "../legal-reasoning.server";
import type { StratifiedRetrieval, Syllogisme, RetrievedSource } from "../lre-schemas.server";

function makeSource(n: number, content: string, opts: Partial<RetrievedSource> = {}): RetrievedSource {
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
    ...opts,
  };
}

function makeRetrieval(sources: RetrievedSource[]): StratifiedRetrieval {
  return {
    legislation: sources.filter((s) => s.lane === "legislation"),
    convention: sources.filter((s) => s.lane === "convention"),
    jurisprudence: sources.filter((s) => s.lane === "jurisprudence"),
    total: sources.length,
    date_at_filter: null,
    idcc_filter: null,
  };
}

function makeSyllogism(opts: {
  majeureCitation: string;
  majeureSourceId: number;
  niveau?: "loi" | "convention_collective" | "jurisprudence";
  confidence?: "haute" | "moyenne" | "faible";
}): Syllogisme {
  return {
    majeure: {
      regle: "Règle de droit",
      citation_verbatim: opts.majeureCitation,
      source_id: opts.majeureSourceId,
      niveau_normatif: opts.niveau ?? "loi",
    },
    mineure: { faits_qualifies: "Faits qualifiés" },
    conclusion: {
      application: "Application",
      principe_faveur: null,
      exceptions: [],
    },
    confidence_self: opts.confidence ?? "haute",
    markdown_user: "Réponse",
    citations_secondaires: [],
  };
}

describe("verifyCitations — matching 3 niveaux", () => {
  it("level=exact quand citation_verbatim matche mot-à-mot le content", () => {
    const src = makeSource(1, "L'employeur, qui envisage de licencier un salarié, le convoque à un entretien préalable.");
    const syllog = makeSyllogism({
      majeureCitation: "qui envisage de licencier un salarié",
      majeureSourceId: 1,
    });
    const checks = verifyCitations(syllog, makeRetrieval([src]));
    expect(checks.citation_checks).toHaveLength(1);
    expect(checks.citation_checks[0].level).toBe("exact");
    expect(checks.citation_checks[0].score).toBe(1);
    expect(checks.citation_health).toBe(1);
  });

  it("level=normalized quand la citation matche après normalisation accents/casse/espaces", () => {
    const src = makeSource(1, "L'employeur qui envisage de licencier un salarié");
    const syllog = makeSyllogism({
      majeureCitation: "L'EMPLOYEUR  QUI ENVISAGE DE LICENCIER UN SALARIÉ", // casse + espaces
      majeureSourceId: 1,
    });
    const checks = verifyCitations(syllog, makeRetrieval([src]));
    expect(checks.citation_checks[0].level).toBe("normalized");
    expect(checks.citation_checks[0].score).toBeCloseTo(0.85);
  });

  it("level=fail quand la citation est inventée (non présente dans la source)", () => {
    const src = makeSource(1, "Texte officiel court qui ne contient absolument rien sur les baleines bleues ni sur les vaisseaux spatiaux.");
    const syllog = makeSyllogism({
      majeureCitation: "Les baleines spatiales doivent obtenir leur permis hyperspatial avant Saturne et naviguer galactiquement",
      majeureSourceId: 1,
    });
    const checks = verifyCitations(syllog, makeRetrieval([src]));
    expect(checks.citation_checks[0].level).toBe("fail");
    expect(checks.citation_checks[0].score).toBe(0);
    expect(checks.final_confidence).toBe("faible");
  });

  it("level=fail si source_id ne pointe vers aucune source", () => {
    const src = makeSource(1, "Contenu");
    const syllog = makeSyllogism({
      majeureCitation: "Contenu",
      majeureSourceId: 99, // inexistant
    });
    const checks = verifyCitations(syllog, makeRetrieval([src]));
    expect(checks.citation_checks[0].level).toBe("fail");
    expect(checks.citation_health).toBe(0);
  });

  it("dégrade final_confidence quand health < 0.5", () => {
    const src = makeSource(1, "Vrai texte");
    const syllog = makeSyllogism({
      majeureCitation: "Citation hallucinée jamais vue ailleurs",
      majeureSourceId: 1,
      confidence: "haute",
    });
    const checks = verifyCitations(syllog, makeRetrieval([src]));
    expect(checks.final_confidence).toBe("faible");
  });

  it("ajoute hierarchy_warning quand majeure=jurisprudence ET legislation disponible", () => {
    const codeSrc = makeSource(1, "Article du code", { source_type: "code_article", lane: "legislation" });
    const jpSrc = makeSource(2, "Arrêt Cass", { source_type: "jurisprudence", lane: "jurisprudence" });
    const syllog = makeSyllogism({
      majeureCitation: "Arrêt Cass",
      majeureSourceId: 2,
      niveau: "jurisprudence",
    });
    const checks = verifyCitations(syllog, makeRetrieval([codeSrc, jpSrc]));
    expect(checks.hierarchy_warnings).toContain("Majeure citée en jurisprudence alors qu'une source législative existe");
  });

  it("détecte violation temporelle quand legal_date > date_faits", () => {
    const src = makeSource(1, "Texte loi 2025", { legal_date: "2025-06-01" });
    const syllog = makeSyllogism({
      majeureCitation: "Texte loi 2025",
      majeureSourceId: 1,
    });
    const retrieval: StratifiedRetrieval = {
      ...makeRetrieval([src]),
      date_at_filter: "2024-01-01", // faits avant la loi citée
    };
    const checks = verifyCitations(syllog, retrieval);
    expect(checks.temporal_violations).toHaveLength(1);
    expect(checks.temporal_violations[0].source_id).toBe(1);
  });
});
