// Validate that an LLM answer is properly grounded in the supplied chunks.
// Returns coverage metrics and a should_warn flag.

export interface CitationValidationResult {
  citation_coverage_score: number; // % of legal sentences with at least one [source:N]
  unsupported_claims: string[];     // legal-looking sentences without any citation
  invalid_citations: string[];      // [source:N] where N is out of range
  source_relevance_score: number;   // proxy = coverage
  should_warn: boolean;
}

const LEGAL_KEYWORDS =
  /\b(article|loi|décret|décrets?|convention|cass\.|jurisprudence|alinéa|code\s+du\s+travail|c\.\s*trav\.|cph|prud['’]hommes?)\b/i;

export function validateAnswerCitations(
  answer: string,
  chunkCount: number,
): CitationValidationResult {
  if (!answer || chunkCount <= 0) {
    return {
      citation_coverage_score: 0,
      unsupported_claims: [],
      invalid_citations: [],
      source_relevance_score: 0,
      should_warn: chunkCount > 0,
    };
  }

  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  const legalSentences = sentences.filter((s) => LEGAL_KEYWORDS.test(s));
  const citationRegex = /\[source:(\d+)\]/g;
  const cited = legalSentences.filter((s) => /\[source:\d+\]/.test(s));

  const coverage =
    legalSentences.length > 0 ? cited.length / legalSentences.length : 1;

  const allCitations = [...answer.matchAll(citationRegex)].map((m) =>
    parseInt(m[1], 10),
  );
  const invalid = allCitations
    .filter((n) => !Number.isFinite(n) || n < 1 || n > chunkCount)
    .map((n) => `[source:${n}]`);

  const unsupported = legalSentences
    .filter((s) => !/\[source:\d+\]/.test(s))
    .slice(0, 5);

  return {
    citation_coverage_score: Number(coverage.toFixed(3)),
    unsupported_claims: unsupported,
    invalid_citations: [...new Set(invalid)],
    source_relevance_score: Number(coverage.toFixed(3)),
    should_warn: coverage < 0.7 || invalid.length > 0,
  };
}
