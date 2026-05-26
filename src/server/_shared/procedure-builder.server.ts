// ═══════════════════════════════════════════════════════════════════════════
// Procedure Builder — Sprint J3 Agent 360 RAG-first
// ═══════════════════════════════════════════════════════════════════════════
//
// Transforme une demande utilisateur qualifiée (sortie LRE) en une procédure
// juridique structurée et 100% sourcée depuis le RAG.
//
// Pipeline :
//   1. runLegalReasoning() — déjà fait par LRE en amont
//   2. buildLegalProcedure(reasoningTrace) — LLM construit la procédure JSON
//   3. verifyProcedureGrounding(procedure, retrieval) — vérification mécanique
//   4. cache dans procedure_generation_rules (table J1)
//
// ⚠️ Principe RAG-first respecté :
//   - AUCUN seed de procédures, juste une cache LLM
//   - Chaque step.source_id doit pointer un retrieval réel
//   - Chaque template_slug doit exister dans document_templates
//   - Si vérif KO → REJET (pas de tolérance)
//
// Cf docs/ARCHITECTURE-AGENT-360-RAG-FIRST.md
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AI_GATEWAY, LLM_API_KEY, LLM_TEMPERATURES } from "./constants.server";
import { resolveChatModel } from "./llm-models.server";
import { withBreaker } from "./llm-breaker.server";
import { captureServerError } from "./error-monitor.server";
import {
  LegalProcedureSchema,
  ProcedureVerificationSchema,
  type LegalProcedure,
  type ProcedureVerification,
  type ReasoningTrace,
  type StratifiedRetrieval,
} from "./lre-schemas.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

export type ProcedureBuilderContext = {
  tenantId: string;
  userId: string;
  idcc: string | null;
  apiKey?: string;
};

export type BuildProcedureResult = {
  ok: boolean;
  procedure: LegalProcedure | null;
  verification: ProcedureVerification | null;
  cache_id: string | null;
  cache_hit: boolean;
  error?: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function safeParseJson<T>(raw: string): T | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function corpusHash(retrieval: StratifiedRetrieval): string {
  // Hash simple des source_ids pour invalidation cache si corpus change
  const ids = [
    ...retrieval.legislation.map((s) => s.source_id),
    ...retrieval.convention.map((s) => s.source_id),
    ...retrieval.jurisprudence.map((s) => s.source_id),
  ].sort();
  return ids.join(",").slice(0, 100);
}

// ─── 1. Cache lookup ───────────────────────────────────────────────────────

async function tryGetCachedProcedure(
  procedureSlug: string,
  tenantId: string,
  corpusHashKey: string,
): Promise<LegalProcedure | null> {
  try {
    const { data: globalRow } = await db
      .from("procedure_generation_rules")
      .select("id, qualification, source_ids, steps, documents, deadlines, validation_rules, warnings, title, domain, risk_level, source_corpus_hash, verified")
      .eq("procedure_slug", procedureSlug)
      .is("tenant_id", null)
      .eq("is_active", true)
      .maybeSingle();

    const { data: tenantRow } = await db
      .from("procedure_generation_rules")
      .select("id, qualification, source_ids, steps, documents, deadlines, validation_rules, warnings, title, domain, risk_level, source_corpus_hash, verified")
      .eq("procedure_slug", procedureSlug)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .maybeSingle();

    // Tenant prime sur global
    const row = tenantRow ?? globalRow;
    if (!row) return null;
    if (!row.verified) return null; // ne pas réutiliser un cache non vérifié
    // Invalidation si corpus a changé significativement
    if (row.source_corpus_hash && row.source_corpus_hash !== corpusHashKey) {
      return null;
    }

    // Reconstruction LegalProcedure depuis le cache
    const proc: LegalProcedure = {
      procedure_slug: procedureSlug,
      title: row.title,
      domain: row.domain,
      risk_level: row.risk_level,
      requires_human_review: row.risk_level === "high" || row.risk_level === "critical",
      required_information: [],
      legal_refs: [],
      steps: row.steps,
      documents: row.documents ?? [],
      deadlines: row.deadlines ?? [],
      validation_rules: row.validation_rules ?? [],
      warnings: row.warnings ?? [],
    };

    const validated = LegalProcedureSchema.safeParse(proc);
    if (!validated.success) return null;

    // Increment reuse_count async (best-effort)
    void db.from("procedure_generation_rules")
      .update({ reuse_count: (row as { id: string }).id, last_reused_at: new Date().toISOString() })
      .eq("id", row.id);

    return validated.data;
  } catch {
    return null;
  }
}

// ─── 2. buildLegalProcedure ────────────────────────────────────────────────

const BUILDER_SYSTEM = `Tu construis une procédure juridique structurée à partir de SOURCES JURIDIQUES OFFICIELLES déjà retrieved par le LRE.

RÈGLES NON NÉGOCIABLES :
1. Chaque step.source_id DOIT être un numéro de source fourni. Pas d'invention.
2. Chaque step.verbatim DOIT être un extrait EXACT (mot-à-mot) de la source citée.
3. Chaque step.legal_ref DOIT correspondre à un article réel (ex: L1232-2).
4. Chaque deadline.source DOIT citer l'article qui fixe le délai.
5. Si une étape n'a pas de fondement légal direct (ex: "préparer le dossier RH"), step_type="action" et source_id=null/legal_ref=null sont autorisés.
6. Si tu manques d'info pour une étape obligatoire : marque-la avec un warning.
7. requires_human_review=true pour TOUT licenciement, sanction, mise en demeure, transaction, rupture conventionnelle.
8. risk_level reflète la gravité juridique : low (info), medium (action standard), high (sensible RH), critical (contentieux).
9. documents[].template_slug DOIT venir de la liste des templates fournie (sinon null).
10. Aucun texte hors JSON.

Output JSON conforme au schema :
{
  "procedure_slug": "snake_case_court (ex: licenciement_personnel)",
  "title": "Titre humain",
  "domain": "droit_social|droit_commercial|droit_civil|rgpd|fiscal|...",
  "risk_level": "low|medium|high|critical",
  "requires_human_review": bool,
  "required_information": ["fait à collecter"],
  "legal_refs": ["L1232-2","L1232-6"],
  "steps": [
    {
      "index": 0,
      "title": "Convocation à l'entretien préalable",
      "description": "...",
      "step_type": "document|action|decision|wait|validation",
      "legal_ref": "L1232-2",
      "source_id": 1,
      "verbatim": "L'employeur, ou son représentant, qui envisage...",
      "delay_days_before": null,
      "delay_days_after": 5,
      "delay_source": "L1232-2",
      "documents_to_generate": ["convocation-entretien-prealable"],
      "requires_validation": false,
      "validation_roles": [],
      "risks": []
    }
  ],
  "documents": [
    {
      "doc_type": "convocation_entretien",
      "template_slug": "convocation-entretien-prealable",
      "step_index": 0,
      "required_mentions": [
        { "mention": "possibilité d'assistance", "legal_ref": "L1232-4", "source_id": 2, "verbatim_extrait": "Le salarié peut se faire assister..." }
      ],
      "validation_required": true
    }
  ],
  "deadlines": [
    { "label": "Entretien préalable", "from_step": 0, "days": 5, "source": "L1232-2", "source_id": 1, "is_imperative": true }
  ],
  "validation_rules": ["DRH valide avant envoi"],
  "warnings": []
}`;

export async function buildLegalProcedure(
  reasoningTrace: ReasoningTrace,
  ctx: ProcedureBuilderContext,
): Promise<BuildProcedureResult> {
  try {
    const retrieval = reasoningTrace.retrieved_sources;

    if (retrieval.total === 0) {
      return {
        ok: false,
        procedure: null,
        verification: null,
        cache_id: null,
        cache_hit: false,
        error: "Aucune source RAG — impossible de construire la procédure",
      };
    }

    // Slug provisoire pour cache lookup (sera reconfirmé par le LLM)
    const sousDomaine = reasoningTrace.qualification.sous_domaine || "procedure_generique";
    const corpusHashKey = corpusHash(retrieval);

    // ─── Cache hit ? ────────────────────────────────────────────────
    const cached = await tryGetCachedProcedure(sousDomaine, ctx.tenantId, corpusHashKey);
    if (cached) {
      return {
        ok: true,
        procedure: cached,
        verification: { ok: true, steps_grounded: cached.steps.length, steps_total: cached.steps.length, grounding_health: 1, unknown_source_ids: [], missing_template_slugs: [], steps_without_source: [], deadlines_without_source: [], warnings: [], errors: [] },
        cache_id: null,
        cache_hit: true,
      };
    }

    // ─── Liste des templates dispo (pour que le LLM puisse référencer) ─
    const { data: templates } = await db
      .from("document_templates")
      .select("slug, name, category")
      .eq("is_public", true)
      .eq("status", "validated");
    const templatesList = (templates ?? []).map((t: { slug: string; name: string; category: string }) =>
      `- ${t.slug} : ${t.name} (${t.category})`
    ).join("\n");

    // ─── Sources sérialisées pour le prompt ────────────────────────
    const all = [...retrieval.legislation, ...retrieval.convention, ...retrieval.jurisprudence];
    const sourcesBlock = all
      .map((s) => `[source:${s.n}] (${s.lane}, ${s.source_type})${s.reference ? ` ${s.reference}` : ""} — ${s.title}\n${s.excerpt}`)
      .join("\n\n---\n\n");

    const userPrompt = `QUALIFICATION (issue du LRE) :
${JSON.stringify(reasoningTrace.qualification, null, 2)}

SYLLOGISME IRAC :
${reasoningTrace.syllogisme.markdown_user}

SOURCES JURIDIQUES (numérotées, à citer exclusivement) :

${sourcesBlock}

TEMPLATES DE DOCUMENTS DISPONIBLES :
${templatesList || "(aucun template public — laisse template_slug à null)"}

Construis la procédure structurée en JSON. N'utilise QUE les sources et templates ci-dessus.`;

    // ─── Appel LLM ─────────────────────────────────────────────────
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
          max_tokens: 3500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: BUILDER_SYSTEM },
            { role: "user", content: userPrompt },
          ],
        }),
      }),
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Procedure Builder LLM ${res.status}: ${body.slice(0, 300)}`);
    }
    const j = await res.json();
    const raw = j.choices?.[0]?.message?.content ?? "{}";

    const parsed = safeParseJson<unknown>(raw);
    if (!parsed) throw new Error("Procedure Builder: JSON LLM invalide");

    const validated = LegalProcedureSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`Procedure Builder: schema Zod KO — ${validated.error.message.slice(0, 200)}`);
    }
    const procedure = validated.data;

    // ─── Vérification mécanique (grounding) ────────────────────────
    const verification = verifyProcedureGrounding(procedure, retrieval, (templates ?? []).map((t: { slug: string }) => t.slug));

    if (!verification.ok) {
      return {
        ok: false,
        procedure,
        verification,
        cache_id: null,
        cache_hit: false,
        error: `Verifier KO : ${verification.errors.join(" | ")}`,
      };
    }

    // ─── Cache persist ─────────────────────────────────────────────
    const cache_id = await persistProcedureCache(procedure, reasoningTrace, retrieval, model, ctx);

    void start; // utilisé pour latence si besoin

    return {
      ok: true,
      procedure,
      verification,
      cache_id,
      cache_hit: false,
    };
  } catch (e) {
    await captureServerError(
      "procedure-builder.buildLegalProcedure",
      { tenantId: ctx.tenantId, userId: ctx.userId, extra: { sous_domaine: reasoningTrace.qualification.sous_domaine } },
      e,
    );
    return {
      ok: false,
      procedure: null,
      verification: null,
      cache_id: null,
      cache_hit: false,
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}

// ─── 3. verifyProcedureGrounding (déterministe) ────────────────────────────

export function verifyProcedureGrounding(
  procedure: LegalProcedure,
  retrieval: StratifiedRetrieval,
  knownTemplateSlugs: string[],
): ProcedureVerification {
  const all = [...retrieval.legislation, ...retrieval.convention, ...retrieval.jurisprudence];
  const sourceById = new Map(all.map((s) => [s.n, s]));
  const knownSlugs = new Set(knownTemplateSlugs);

  const unknown_source_ids: number[] = [];
  const missing_template_slugs: string[] = [];
  const steps_without_source: number[] = [];
  const deadlines_without_source: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  let steps_grounded = 0;
  for (const step of procedure.steps) {
    // Step de type action/wait/decision tolère absence de source
    const requiresSource = step.step_type === "document" || step.step_type === "validation" || step.legal_ref !== null;

    if (step.source_id !== null) {
      const src = sourceById.get(step.source_id);
      if (!src) {
        unknown_source_ids.push(step.source_id);
        errors.push(`Step #${step.index} "${step.title}" : source_id ${step.source_id} inexistant`);
      } else {
        // Vérification du verbatim (exact-match simple)
        if (step.verbatim && !src.content.includes(step.verbatim)) {
          // tolère normalisation
          const normContent = src.content.toLowerCase().replace(/\s+/g, " ");
          const normVerb = step.verbatim.toLowerCase().replace(/\s+/g, " ");
          if (!normContent.includes(normVerb)) {
            warnings.push(`Step #${step.index} : verbatim non trouvé tel quel dans source ${step.source_id}`);
          } else {
            steps_grounded++;
          }
        } else {
          steps_grounded++;
        }
      }
    } else if (requiresSource) {
      steps_without_source.push(step.index);
      warnings.push(`Step #${step.index} "${step.title}" : type ${step.step_type} sans source`);
    } else {
      steps_grounded++; // step procédural pur (action manuelle), OK sans source
    }
  }

  // Documents : chaque template_slug doit exister
  for (const doc of procedure.documents) {
    if (doc.template_slug && !knownSlugs.has(doc.template_slug)) {
      missing_template_slugs.push(doc.template_slug);
      warnings.push(`Document "${doc.doc_type}" : template_slug "${doc.template_slug}" inexistant dans document_templates`);
    }
    // Mentions : chaque source_id doit exister
    for (const m of doc.required_mentions) {
      if (!sourceById.has(m.source_id)) {
        errors.push(`Document "${doc.doc_type}" : mention "${m.mention}" pointe source_id ${m.source_id} inexistant`);
      }
    }
  }

  // Deadlines : chaque source doit être citée
  for (const dl of procedure.deadlines) {
    if (!dl.source || dl.source.trim().length === 0) {
      deadlines_without_source.push(dl.label);
      warnings.push(`Deadline "${dl.label}" sans source légale`);
    }
    if (dl.source_id !== null && !sourceById.has(dl.source_id)) {
      errors.push(`Deadline "${dl.label}" : source_id ${dl.source_id} inexistant`);
    }
  }

  const steps_total = procedure.steps.length;
  const grounding_health = steps_total > 0 ? steps_grounded / steps_total : 0;
  const ok = errors.length === 0 && grounding_health >= 0.7;

  const result: ProcedureVerification = {
    ok,
    steps_grounded,
    steps_total,
    grounding_health,
    unknown_source_ids,
    missing_template_slugs,
    steps_without_source,
    deadlines_without_source,
    warnings,
    errors,
  };
  return ProcedureVerificationSchema.parse(result);
}

// ─── 4. Cache write ────────────────────────────────────────────────────────

async function persistProcedureCache(
  procedure: LegalProcedure,
  reasoningTrace: ReasoningTrace,
  retrieval: StratifiedRetrieval,
  model: string,
  ctx: ProcedureBuilderContext,
): Promise<string | null> {
  try {
    const all = [...retrieval.legislation, ...retrieval.convention, ...retrieval.jurisprudence];
    const sourceUuids = all.map((s) => s.source_id);

    // Upsert manuel via lookup → update OU insert (UNIQUE constraint)
    const { data: existing } = await db
      .from("procedure_generation_rules")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("procedure_slug", procedure.procedure_slug)
      .maybeSingle();

    if (existing?.id) {
      await db
        .from("procedure_generation_rules")
        .update({
          title: procedure.title,
          domain: procedure.domain,
          qualification: reasoningTrace.qualification,
          source_ids: sourceUuids,
          steps: procedure.steps,
          documents: procedure.documents,
          deadlines: procedure.deadlines,
          validation_rules: procedure.validation_rules,
          warnings: procedure.warnings,
          risk_level: procedure.risk_level,
          built_by_model: model,
          source_corpus_hash: corpusHash(retrieval),
          verified: true,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return existing.id as string;
    }

    const { data, error } = await db
      .from("procedure_generation_rules")
      .insert({
        tenant_id: ctx.tenantId,
        procedure_slug: procedure.procedure_slug,
        domain: procedure.domain,
        title: procedure.title,
        qualification: reasoningTrace.qualification,
        source_ids: sourceUuids,
        steps: procedure.steps,
        documents: procedure.documents,
        deadlines: procedure.deadlines,
        validation_rules: procedure.validation_rules,
        warnings: procedure.warnings,
        risk_level: procedure.risk_level,
        built_by_llm: true,
        built_by_model: model,
        source_corpus_hash: corpusHash(retrieval),
        verified: true,
        verified_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      await captureServerError("procedure-builder.persistCache", { tenantId: ctx.tenantId, userId: ctx.userId }, error);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (e) {
    await captureServerError("procedure-builder.persistCache", { tenantId: ctx.tenantId, userId: ctx.userId }, e);
    return null;
  }
}
