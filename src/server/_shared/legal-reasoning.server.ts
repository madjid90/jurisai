// ═══════════════════════════════════════════════════════════════════════════
// Legal Reasoning Engine (LRE) — Sprint J2 Agent 360 RAG-first
// ═══════════════════════════════════════════════════════════════════════════
//
// Cerveau juridique entre l'Agent 360 et la data juridique (190k chunks RAG).
// Construit le raisonnement IRAC en 4 passes :
//   1. qualifyLegalIssue        — extraction structurée (branche, faits, parties)
//   2. retrieveStratifiedSources — RAG par lane (legislation/convention/JP/doctrine)
//   3. applyNormativeHierarchy   — tri par rang d'autorité (table legal_source_hierarchy)
//   4. buildLegalSyllogism       — majeure/mineure/conclusion sourcées
//   5. verifyCitations           — exact-match 3 niveaux entre output et chunks réels
//   6. persistReasoningTrace     — append-only dans legal_reasoning_traces
//
// runLegalReasoning() orchestre les 6 ci-dessus et retourne un ReasoningTrace
// complet validé Zod, prêt à être consommé par Procedure Builder (J3).
//
// ⚠️ Principe RAG-first : AUCUNE règle juridique hardcodée. Tout vient du RAG.
//    Cf docs/ARCHITECTURE-AGENT-360-RAG-FIRST.md
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AI_GATEWAY, LLM_API_KEY, LLM_TEMPERATURES } from "./constants.server";
import { resolveChatModel } from "./llm-models.server";
import { withBreaker } from "./llm-breaker.server";
import { sanitizePromptInput, PROMPT_INJECTION_GUARD } from "./prompt-sanitizer.server";
import { captureServerError } from "./error-monitor.server";
import {
  LegalQualificationSchema,
  StratifiedRetrievalSchema,
  SyllogismeSchema,
  VerificationChecksSchema,
  ReasoningTraceSchema,
  classifyLane,
  type LegalQualification,
  type StratifiedRetrieval,
  type RetrievedSource,
  type Syllogisme,
  type VerificationChecks,
  type ReasoningTrace,
} from "./lre-schemas.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

export type LREContext = {
  tenantId: string;
  userId: string;
  idcc: string | null;
  agentRunId: string | null;
  apiKey?: string;
  mode?: "standard" | "deep";
};

export type LREResult = {
  ok: boolean;
  trace: ReasoningTrace | null;
  trace_id: string | null;
  error?: string;
};

// ─── Helpers communs ───────────────────────────────────────────────────────

function safeParseJson<T>(raw: string): T | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

async function llmJsonCall(
  systemPrompt: string,
  userPrompt: string,
  ctx: LREContext,
  schemaName: string,
): Promise<{ raw: string; latencyMs: number }> {
  const start = Date.now();
  const model = await resolveChatModel(ctx.tenantId);
  const res = await withBreaker(model, () =>
    fetch(`${AI_GATEWAY}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.apiKey ?? LLM_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: LLM_TEMPERATURES.classification,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    }),
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LRE ${schemaName} LLM ${res.status}: ${body.slice(0, 300)}`);
  }
  const j = await res.json();
  return {
    raw: j.choices?.[0]?.message?.content ?? "{}",
    latencyMs: Date.now() - start,
  };
}

// ─── 1. qualifyLegalIssue ──────────────────────────────────────────────────

const QUALIFY_SYSTEM = `Tu es un juriste expert qui qualifie une demande utilisateur.

Tu retournes STRICTEMENT un JSON conforme à ce schema :
{
  "issue": "question de droit reformulée par un juriste",
  "branche": "social|commercial|civil|rgpd|fiscal|contentieux|societes|administratif|penal_des_affaires|immobilier|famille|international_prive",
  "sous_domaine": "concept précis en snake_case (ex: licenciement_disciplinaire)",
  "parties": ["employeur","salarie",...],
  "faits_materiels": ["fait 1", "fait 2"],
  "date_faits": "YYYY-MM-DD ou null",
  "idcc_hypothesis": "code IDCC ou null",
  "sous_questions_rag": ["sous-question 1", "..."],
  "articles_pivots": ["L1232-1", "..."],
  "urgence": "aucune|delai_court|delai_legal_strict",
  "complexity": "low|medium|high",
  "missing_info": ["info manquante 1", "..."],
  "refuse": false,
  "refuse_reason": null
}

RÈGLES STRICTES :
1. Sépare les FAITS du DROIT — les faits_materiels ne contiennent JAMAIS de qualification juridique
2. sous_questions_rag = 1 à 5 sous-questions précises pour interroger la base juridique
3. articles_pivots = articles que tu pré-identifies (sera vérifié par le RAG, peut être [])
4. Si la demande est hors-droit ou non éthique : refuse=true, refuse_reason rempli, autres champs en valeurs vides
5. Aucun texte hors JSON.`;

export async function qualifyLegalIssue(
  question: string,
  ctx: LREContext,
): Promise<{ qualification: LegalQualification; latencyMs: number }> {
  const idccBlock = ctx.idcc ? `\n\nConvention collective connue : IDCC ${ctx.idcc}` : "";
  const userPrompt = `${PROMPT_INJECTION_GUARD}\n\nDEMANDE :\n${sanitizePromptInput(question.slice(0, 3000), { label: "DEMANDE" })}${idccBlock}`;

  const { raw, latencyMs } = await llmJsonCall(QUALIFY_SYSTEM, userPrompt, ctx, "qualify");
  const parsed = safeParseJson<unknown>(raw);
  if (!parsed) throw new Error("LRE qualify: JSON LLM invalide");

  const validated = LegalQualificationSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`LRE qualify: schema Zod KO — ${validated.error.message.slice(0, 200)}`);
  }
  return { qualification: validated.data, latencyMs };
}

// ─── 2. retrieveStratifiedSources ──────────────────────────────────────────

export async function retrieveStratifiedSources(
  qualification: LegalQualification,
  ctx: LREContext,
): Promise<{ retrieval: StratifiedRetrieval; latencyMs: number }> {
  const start = Date.now();

  // 1 sous-question = 1 appel hybrid_search_typed par lane
  // (la lane est forcée en filtrant les source_types)
  const lanes: Array<{ name: "legislation" | "convention" | "jurisprudence"; types: string[] }> = [
    { name: "legislation", types: ["code_article", "loi", "decret", "arrete", "loi_organique"] },
    { name: "convention", types: ["convention_article", "accord_branche", "accord_entreprise"] },
    { name: "jurisprudence", types: ["jurisprudence", "jurisprudence_admin"] },
  ];

  const buckets: Record<string, RetrievedSource[]> = {
    legislation: [],
    convention: [],
    jurisprudence: [],
  };

  let counter = 1;
  for (const sub of qualification.sous_questions_rag.slice(0, 3)) {
    // Embedding via la couche existante (cache OpenAI text-embedding-3-small)
    const { embedText } = await import("./llm-embeddings.server");
    const embedRes = await embedText(sub);
    if (!embedRes.ok || !embedRes.embedding) continue;
    const embedding = embedRes.embedding;

    for (const lane of lanes) {
      const { data } = await db.rpc("hybrid_search_typed", {
        query_embedding: embedding,
        query_text: sub,
        match_count: 5,
        source_types: lane.types,
        idcc_filter: lane.name === "convention" ? ctx.idcc : null,
        date_at: qualification.date_faits,
      });

      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        // Dédup par chunk_id
        if (buckets[lane.name].some((r) => r.chunk_id === row.chunk_id)) continue;

        buckets[lane.name].push({
          n: counter++,
          chunk_id: String(row.chunk_id),
          source_id: String(row.source_id),
          title: String(row.source_title ?? ""),
          reference: row.reference_code ? String(row.reference_code) : null,
          url: row.official_url ? String(row.official_url) : null,
          source_type: String(row.source_type),
          lane: classifyLane(String(row.source_type)) as "legislation" | "convention" | "jurisprudence" | "doctrine",
          content: String(row.content ?? ""),
          excerpt: String(row.content ?? "").slice(0, 700),
          legal_date: row.legal_date ? String(row.legal_date) : null,
          score: Number(row.score ?? 0),
        });
      }
    }
  }

  const retrieval: StratifiedRetrieval = {
    legislation: buckets.legislation.slice(0, 10),
    convention: buckets.convention.slice(0, 8),
    jurisprudence: buckets.jurisprudence.slice(0, 5),
    total: buckets.legislation.length + buckets.convention.length + buckets.jurisprudence.length,
    date_at_filter: qualification.date_faits,
    idcc_filter: ctx.idcc,
  };

  const validated = StratifiedRetrievalSchema.safeParse(retrieval);
  if (!validated.success) {
    throw new Error(`LRE retrieve: schema KO — ${validated.error.message.slice(0, 200)}`);
  }
  return { retrieval: validated.data, latencyMs: Date.now() - start };
}

// ─── 3. applyNormativeHierarchy ────────────────────────────────────────────

export async function applyNormativeHierarchy(
  retrieval: StratifiedRetrieval,
): Promise<StratifiedRetrieval> {
  // Lecture du référentiel (cached côté DB, peu coûteux)
  const { data: hierarchy } = await db
    .from("legal_source_hierarchy")
    .select("source_type, authority_rank, procedure_boost, document_boost");

  const rankMap = new Map<string, number>();
  for (const h of (hierarchy ?? []) as Array<{ source_type: string; authority_rank: number }>) {
    rankMap.set(h.source_type, h.authority_rank);
  }

  // Tri intra-lane par rank ASC (plus prioritaire d'abord) puis score DESC
  const sortFn = (a: RetrievedSource, b: RetrievedSource) => {
    const ra = rankMap.get(a.source_type) ?? 99;
    const rb = rankMap.get(b.source_type) ?? 99;
    if (ra !== rb) return ra - rb;
    return b.score - a.score;
  };

  return {
    ...retrieval,
    legislation: [...retrieval.legislation].sort(sortFn),
    convention: [...retrieval.convention].sort(sortFn),
    jurisprudence: [...retrieval.jurisprudence].sort(sortFn),
  };
}

// ─── 4. buildLegalSyllogism ────────────────────────────────────────────────

const SYLLOGISM_SYSTEM = `Tu construis un syllogisme juridique IRAC à partir de SOURCES JURIDIQUES OFFICIELLES fournies.

RÈGLES NON NÉGOCIABLES :
1. citation_verbatim DOIT être un extrait EXACT (mot-à-mot) d'une des sources fournies. Pas de reformulation.
2. source_id DOIT être un numéro [source:N] correspondant à une source fournie. Jamais inventé.
3. La MAJEURE doit citer une source de niveau "loi" ou "convention_collective" si disponible. Jurisprudence en dernier recours.
4. Si branche=social et qu'une convention collective existe (idcc fourni) ET diffère du légal :
   - principe_faveur.applicable = true
   - niveau_retenu = la plus favorable au salarié
5. Si AUCUNE source ne permet de répondre : refuse en renvoyant une majeure avec citation_verbatim="aucune source disponible"
6. markdown_user = réponse formatée pour l'utilisateur, avec citations [source:N] cliquables.

Output STRICT JSON :
{
  "majeure": { "regle": "...", "citation_verbatim": "...", "source_id": N, "niveau_normatif": "loi|convention_collective|jurisprudence|..." },
  "mineure": { "faits_qualifies": "..." },
  "conclusion": {
    "application": "...",
    "principe_faveur": { "applicable": bool, "niveau_retenu": "legal|conventionnel|null", "justification": "..." } | null,
    "exceptions": [{"regle":"...", "citation_verbatim":"...", "source_id":N}]
  },
  "confidence_self": "haute|moyenne|faible",
  "markdown_user": "...",
  "citations_secondaires": [{"citation_verbatim":"...", "source_id":N}]
}`;

export async function buildLegalSyllogism(
  qualification: LegalQualification,
  retrieval: StratifiedRetrieval,
  ctx: LREContext,
): Promise<{ syllogisme: Syllogisme; latencyMs: number }> {
  // Sérialise les sources pour le prompt LLM
  const all = [...retrieval.legislation, ...retrieval.convention, ...retrieval.jurisprudence];
  if (all.length === 0) {
    throw new Error("LRE syllogism: aucune source RAG pour construire le syllogisme");
  }

  const sourcesBlock = all
    .map((s) => `[source:${s.n}] (${s.lane}, ${s.source_type}) ${s.title}${s.reference ? ` — ${s.reference}` : ""}\n${s.excerpt}`)
    .join("\n\n---\n\n");

  const userPrompt = `QUALIFICATION :\n${JSON.stringify(qualification, null, 2)}\n\nSOURCES JURIDIQUES (numérotées) :\n\n${sourcesBlock}\n\nConstruis le syllogisme IRAC. Cite UNIQUEMENT depuis ces sources.`;

  const { raw, latencyMs } = await llmJsonCall(SYLLOGISM_SYSTEM, userPrompt, ctx, "syllogism");
  const parsed = safeParseJson<unknown>(raw);
  if (!parsed) throw new Error("LRE syllogism: JSON invalide");

  const validated = SyllogismeSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`LRE syllogism: schema KO — ${validated.error.message.slice(0, 200)}`);
  }
  return { syllogisme: validated.data, latencyMs };
}

// ─── 5. verifyCitations (3 niveaux exact / normalized / fuzzy) ─────────────

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyContains(haystack: string, needle: string): boolean {
  // Jaccard sur tokens 4+ caractères
  const tokens = (s: string) =>
    new Set(normalizeForMatch(s).split(/\s+/).filter((t) => t.length >= 4));
  const A = tokens(haystack);
  const B = tokens(needle);
  if (B.size === 0) return false;
  let intersect = 0;
  for (const t of B) if (A.has(t)) intersect++;
  return intersect / B.size >= 0.7;
}

export function verifyCitations(
  syllogisme: Syllogisme,
  retrieval: StratifiedRetrieval,
): VerificationChecks {
  const all = [...retrieval.legislation, ...retrieval.convention, ...retrieval.jurisprudence];
  const sourceById = new Map(all.map((s) => [s.n, s]));

  type Citation = { source_id: number; citation_verbatim: string };
  const citations: Citation[] = [
    { source_id: syllogisme.majeure.source_id, citation_verbatim: syllogisme.majeure.citation_verbatim },
    ...syllogisme.conclusion.exceptions.map((e) => ({ source_id: e.source_id, citation_verbatim: e.citation_verbatim })),
    ...syllogisme.citations_secondaires,
  ];

  const checks = citations.map((cit) => {
    const src = sourceById.get(cit.source_id);
    if (!src) {
      return {
        source_id: cit.source_id,
        level: "fail" as const,
        score: 0,
        citation_excerpt: cit.citation_verbatim.slice(0, 100),
      };
    }
    // 3 niveaux
    if (src.content.includes(cit.citation_verbatim)) {
      return { source_id: cit.source_id, level: "exact" as const, score: 1, citation_excerpt: cit.citation_verbatim.slice(0, 100) };
    }
    if (normalizeForMatch(src.content).includes(normalizeForMatch(cit.citation_verbatim))) {
      return { source_id: cit.source_id, level: "normalized" as const, score: 0.85, citation_excerpt: cit.citation_verbatim.slice(0, 100) };
    }
    if (fuzzyContains(src.content, cit.citation_verbatim)) {
      return { source_id: cit.source_id, level: "fuzzy" as const, score: 0.6, citation_excerpt: cit.citation_verbatim.slice(0, 100) };
    }
    return { source_id: cit.source_id, level: "fail" as const, score: 0, citation_excerpt: cit.citation_verbatim.slice(0, 100) };
  });

  const citation_health =
    checks.length > 0 ? checks.reduce((acc, c) => acc + c.score, 0) / checks.length : 0;

  // Détection temporelle
  const temporal_violations: VerificationChecks["temporal_violations"] = [];
  const dateF = retrieval.date_at_filter;
  if (dateF) {
    for (const cit of citations) {
      const src = sourceById.get(cit.source_id);
      if (src?.legal_date && src.legal_date > dateF) {
        temporal_violations.push({
          source_id: cit.source_id,
          legal_date: src.legal_date,
          date_faits: dateF,
        });
      }
    }
  }

  // Hierarchy warnings
  const hierarchy_warnings: string[] = [];
  if (syllogisme.majeure.niveau_normatif === "jurisprudence" && retrieval.legislation.length > 0) {
    hierarchy_warnings.push("Majeure citée en jurisprudence alors qu'une source législative existe");
  }

  // Final confidence : dégradée par les checks
  let final_confidence: "haute" | "moyenne" | "faible" = syllogisme.confidence_self;
  if (citation_health < 0.5) final_confidence = "faible";
  else if (citation_health < 0.8 && final_confidence === "haute") final_confidence = "moyenne";
  if (temporal_violations.length > 0 || hierarchy_warnings.length > 0) {
    if (final_confidence === "haute") final_confidence = "moyenne";
  }

  const out: VerificationChecks = {
    citation_health,
    citation_checks: checks,
    temporal_violations,
    hierarchy_warnings,
    faveur_injected: false,
    final_confidence,
  };
  return VerificationChecksSchema.parse(out);
}

// ─── 6. persistReasoningTrace ──────────────────────────────────────────────

export async function persistReasoningTrace(
  question: string,
  trace: ReasoningTrace,
  ctx: LREContext,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("legal_reasoning_traces")
      .insert({
        tenant_id: ctx.tenantId,
        agent_run_id: ctx.agentRunId,
        user_id: ctx.userId,
        question,
        qualification: trace.qualification,
        retrieved_sources: trace.retrieved_sources,
        syllogisme: trace.syllogisme,
        checks: trace.checks,
        final_confidence: trace.final_confidence,
        citation_health: trace.citation_health,
        mode: trace.mode,
        total_llm_calls: trace.total_llm_calls,
        total_latency_ms: trace.total_latency_ms,
        total_tokens: trace.total_tokens,
        cost_eur: trace.cost_eur,
        refused: trace.refused,
        refusal_reason: trace.refusal_reason,
      })
      .select("id")
      .single();
    if (error) {
      await captureServerError("lre.persistReasoningTrace", { tenantId: ctx.tenantId, userId: ctx.userId }, error);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (e) {
    await captureServerError("lre.persistReasoningTrace", { tenantId: ctx.tenantId, userId: ctx.userId }, e);
    return null;
  }
}

// ─── 7. runLegalReasoning — orchestrateur ──────────────────────────────────

export async function runLegalReasoning(
  question: string,
  ctx: LREContext,
): Promise<LREResult> {
  const startTotal = Date.now();
  let totalLatency = 0;
  let llmCalls = 0;

  try {
    // 1. Qualification
    const { qualification, latencyMs: l1 } = await qualifyLegalIssue(question, ctx);
    totalLatency += l1;
    llmCalls++;

    // Court-circuit : refus
    if (qualification.refuse) {
      const trace: ReasoningTrace = {
        question,
        qualification,
        retrieved_sources: { legislation: [], convention: [], jurisprudence: [], total: 0, date_at_filter: null, idcc_filter: null },
        syllogisme: {
          majeure: { regle: "Demande refusée", citation_verbatim: "n/a", source_id: 0, niveau_normatif: "loi" },
          mineure: { faits_qualifies: "n/a" },
          conclusion: { application: qualification.refuse_reason ?? "Demande hors-droit", principe_faveur: null, exceptions: [] },
          confidence_self: "faible",
          markdown_user: `**Demande refusée** : ${qualification.refuse_reason ?? "hors-droit"}`,
          citations_secondaires: [],
        },
        checks: { citation_health: 0, citation_checks: [], temporal_violations: [], hierarchy_warnings: [], faveur_injected: false, final_confidence: "faible" },
        final_confidence: "faible",
        citation_health: 0,
        mode: ctx.mode ?? "standard",
        total_llm_calls: llmCalls,
        total_latency_ms: Date.now() - startTotal,
        total_tokens: null,
        cost_eur: null,
        refused: true,
        refusal_reason: qualification.refuse_reason,
      };
      const trace_id = await persistReasoningTrace(question, trace, ctx);
      return { ok: true, trace, trace_id };
    }

    // 2. Retrieval stratifié
    const { retrieval: rawRetrieval, latencyMs: l2 } = await retrieveStratifiedSources(qualification, ctx);
    totalLatency += l2;

    // 3. Hiérarchie normative (tri intra-lane)
    const retrieval = await applyNormativeHierarchy(rawRetrieval);

    // Garde-fou : si vraiment 0 source, on refuse
    if (retrieval.total === 0) {
      const trace: ReasoningTrace = {
        question,
        qualification,
        retrieved_sources: retrieval,
        syllogisme: {
          majeure: { regle: "Pas de source juridique disponible", citation_verbatim: "n/a", source_id: 0, niveau_normatif: "loi" },
          mineure: { faits_qualifies: qualification.faits_materiels.join(" ; ") },
          conclusion: { application: "Aucune source RAG n'a été trouvée pour cette question. Reformulez ou précisez le contexte.", principe_faveur: null, exceptions: [] },
          confidence_self: "faible",
          markdown_user: "_Aucune source juridique disponible dans la base pour répondre à cette question._",
          citations_secondaires: [],
        },
        checks: { citation_health: 0, citation_checks: [], temporal_violations: [], hierarchy_warnings: [], faveur_injected: false, final_confidence: "faible" },
        final_confidence: "faible",
        citation_health: 0,
        mode: ctx.mode ?? "standard",
        total_llm_calls: llmCalls,
        total_latency_ms: Date.now() - startTotal,
        total_tokens: null,
        cost_eur: null,
        refused: true,
        refusal_reason: "no_rag_source",
      };
      const trace_id = await persistReasoningTrace(question, trace, ctx);
      return { ok: true, trace, trace_id };
    }

    // 4. Syllogisme IRAC
    const { syllogisme, latencyMs: l3 } = await buildLegalSyllogism(qualification, retrieval, ctx);
    totalLatency += l3;
    llmCalls++;

    // 5. Vérifications (purement algorithmiques, déterministes)
    const checks = verifyCitations(syllogisme, retrieval);

    // 6. Trace complète
    const trace: ReasoningTrace = {
      question,
      qualification,
      retrieved_sources: retrieval,
      syllogisme,
      checks,
      final_confidence: checks.final_confidence,
      citation_health: checks.citation_health,
      mode: ctx.mode ?? "standard",
      total_llm_calls: llmCalls,
      total_latency_ms: Date.now() - startTotal,
      total_tokens: null,
      cost_eur: null,
      refused: false,
      refusal_reason: null,
    };

    const validated = ReasoningTraceSchema.safeParse(trace);
    if (!validated.success) {
      throw new Error(`LRE trace: schema KO — ${validated.error.message.slice(0, 200)}`);
    }

    const trace_id = await persistReasoningTrace(question, validated.data, ctx);
    return { ok: true, trace: validated.data, trace_id };
  } catch (e) {
    await captureServerError("lre.runLegalReasoning", { tenantId: ctx.tenantId, userId: ctx.userId, extra: { question: question.slice(0, 200) } }, e);
    return { ok: false, trace: null, trace_id: null, error: e instanceof Error ? e.message : "unknown" };
  }
}
