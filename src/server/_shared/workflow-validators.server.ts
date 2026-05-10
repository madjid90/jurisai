// Validation 3 couches d'un workflow généré par l'IA.
//
//  Layer 1 — RAG validator (RE-RAG par étape) : pour chaque étape qui prétend
//            s'appuyer sur des refs légales, on relance searchLegalSources
//            ciblé. Score = % d'étapes confirmées par au moins 1 source.
//
//  Layer 2 — LLM consensus : on demande à 2 modèles distincts (Flash + Pro)
//            d'évaluer la cohérence et la complétude du workflow. Score
//            = moyenne des deux scores 0-100, avec pénalité si désaccord.
//
//  Layer 3 — Safety : detectSensitiveActions + scoring. Pénalise les
//            workflows qui embarquent une action critique sans avocat
//            mentionné ou sans étape de validation humaine.
//
// Renvoie 6 scores + statut auto-déduit (cf. règles V3).

import { searchLegalSources } from "./legal-rag.server";
import { detectSensitiveActions, type WorkflowStepLike, type SensitiveDetectionResult } from "./sensitive-actions.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1";
const FLASH = "google/gemini-2.5-flash";
const PRO = "google/gemini-2.5-pro";
const FLASH_LITE = "google/gemini-2.5-flash-lite"; // 3ᵉ avis (V3 §18)

export type WorkflowDraft = {
  title: string;
  description?: string;
  category: string;
  estimated_duration_days?: number;
  legal_refs?: Array<{ code?: string; source?: string; reference?: string }>;
  steps: Array<WorkflowStepLike & {
    legal_refs?: string[];
    requires_sourcing?: boolean;
    delay_days?: number;
  }>;
};

export type WorkflowScores = {
  legal_refs: number;
  logic: number;
  documents: number;
  completeness: number;
  safety: number;
  overall: number;
};

export type WorkflowQualityReport = {
  scores: WorkflowScores;
  sensitive: SensitiveDetectionResult;
  rerag: {
    steps_checked: number;
    steps_confirmed: number;
    failures: Array<{ step_index: number; step_key: string; reason: string }>;
  };
  consensus: {
    flash: { score: number; agrees: boolean; missing: string[]; comments: string };
    pro:   { score: number; agrees: boolean; missing: string[]; comments: string };
    flash_lite: { score: number; agrees: boolean; missing: string[]; comments: string };
    disagreement: number; // max écart entre les 3 modèles
    agreement_ratio: number; // % de modèles qui s'accordent (agrees=true)
  };
  documents: {
    steps_with_template: number;
    templates_existing: number;
    missing_slugs: string[];
  };
  auto_status: "ai_validated_auto" | "pending_human_review" | "draft_ai";
  reasons: string[];
};

// ─── Layer 1 : RE-RAG par étape ────────────────────────────────────────────

async function reragSteps(draft: WorkflowDraft, idcc: string | null) {
  const stepsToCheck = draft.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => Array.isArray(s.legal_refs) && s.legal_refs!.length > 0);

  let confirmed = 0;
  const failures: WorkflowQualityReport["rerag"]["failures"] = [];

  for (const { s, i } of stepsToCheck) {
    const query = [s.title, s.description, (s.legal_refs ?? []).join(" ")]
      .filter(Boolean).join(" — ").slice(0, 400);
    const r = await searchLegalSources(query, { idcc, limit: 3 });
    if (r.ok && r.sources.length > 0) confirmed++;
    else failures.push({
      step_index: i,
      step_key: s.key ?? `step_${i}`,
      reason: r.reason ?? "Aucune source RAG",
    });
  }

  return {
    steps_checked: stepsToCheck.length,
    steps_confirmed: confirmed,
    failures,
    score: stepsToCheck.length === 0 ? 50 : Math.round((confirmed / stepsToCheck.length) * 100),
  };
}

// ─── Layer 2 : consensus LLM ───────────────────────────────────────────────

const CONSENSUS_SYSTEM = `Tu es un évaluateur juridique. On te soumet un workflow procédural généré par IA.
Évalue STRICTEMENT en JSON :
{
  "score": 0-100,
  "agrees": true|false,
  "missing": ["étape importante manquante 1","..."],
  "comments": "≤ 200 caractères"
}
Critères : ordre logique des étapes, complétude (préparation → exécution → archivage → suivi),
respect des délais légaux, présence des étapes de validation humaine pour actions sensibles.
Aucun texte hors JSON.`;

async function consensusOne(model: string, apiKey: string, draft: WorkflowDraft) {
  const userPayload = {
    title: draft.title,
    category: draft.category,
    description: draft.description,
    steps: draft.steps.map((s, i) => ({
      i,
      title: s.title,
      description: s.description,
      kind: s.kind,
      delay_days: s.delay_days,
      legal_refs: s.legal_refs,
    })),
  };
  try {
    const res = await fetch(`${AI_GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CONSENSUS_SYSTEM },
          { role: "user", content: JSON.stringify(userPayload).slice(0, 8000) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`IA ${res.status}`);
    const j = await res.json();
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
    return {
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      agrees: Boolean(parsed.agrees),
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 8).map(String) : [],
      comments: String(parsed.comments ?? "").slice(0, 250),
    };
  } catch (e) {
    return { score: 0, agrees: false, missing: [], comments: `[error] ${(e as Error).message}` };
  }
}

async function consensusCheck(draft: WorkflowDraft, apiKey: string) {
  const fallback = { score: 0, agrees: false, missing: [] as string[], comments: "[error] model unavailable" };
  const settled = await Promise.allSettled([
    consensusOne(FLASH, apiKey, draft),
    consensusOne(PRO, apiKey, draft),
    consensusOne(FLASH_LITE, apiKey, draft),
  ]);
  const [flash, pro, flashLite] = settled.map((r) => r.status === "fulfilled" ? r.value : fallback);
  const scores = [flash.score, pro.score, flashLite.score];
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const disagreement = max - min;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const penalty = disagreement > 30 ? Math.min(20, disagreement - 30) : 0;
  const agreementRatio = [flash.agrees, pro.agrees, flashLite.agrees].filter(Boolean).length / 3;
  return {
    flash, pro, flash_lite: flashLite,
    disagreement,
    agreement_ratio: agreementRatio,
    score: Math.max(0, Math.round(avg - penalty)),
  };
}

// ─── Documents : présence de templates existants ───────────────────────────

async function checkDocuments(draft: WorkflowDraft, tenantId: string) {
  const slugs = draft.steps
    .map((s) => s.template_slug)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  if (slugs.length === 0) {
    return { steps_with_template: 0, templates_existing: 0, missing_slugs: [], score: 70 };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabaseAdmin
    .from("document_templates")
    .select("slug")
    .in("slug", slugs)
    .or(`is_public.eq.true,tenant_id.eq.${tenantId}`);
  const existing = new Set(((data ?? []) as Array<{ slug: string }>).map((r) => r.slug));
  const missing = slugs.filter((s) => !existing.has(s));
  return {
    steps_with_template: slugs.length,
    templates_existing: existing.size,
    missing_slugs: missing,
    score: Math.round((existing.size / slugs.length) * 100),
  };
}

// ─── Complétude structurelle ───────────────────────────────────────────────

function completenessScore(draft: WorkflowDraft): number {
  let score = 0;
  if (draft.title?.trim().length > 5) score += 15;
  if (draft.description?.trim().length && draft.description.trim().length > 20) score += 10;
  if (draft.category?.trim()) score += 10;
  if (draft.steps.length >= 3) score += 25;
  else if (draft.steps.length >= 1) score += 10;
  // chaque étape : title + description + (kind ou template_slug)
  let okSteps = 0;
  for (const s of draft.steps) {
    const ok = !!s.title && (!!s.description || !!s.template_slug || !!s.kind);
    if (ok) okSteps++;
  }
  if (draft.steps.length > 0) {
    score += Math.round((okSteps / draft.steps.length) * 30);
  }
  // bonus durée estimée fournie
  if (typeof draft.estimated_duration_days === "number") score += 10;
  return Math.min(100, score);
}

// ─── Safety score ──────────────────────────────────────────────────────────

function safetyScore(sensitive: SensitiveDetectionResult, draft: WorkflowDraft): number {
  if (!sensitive.contains_sensitive) return 100;
  let score = 100;
  for (const d of sensitive.detected) {
    if (d.severity === "critical") score -= 25;
    else if (d.severity === "high") score -= 12;
    else if (d.severity === "medium") score -= 5;
  }
  // Bonus si le workflow contient au moins une étape "validation" / "review"
  const hasValidationStep = draft.steps.some((s) => {
    const t = ((s.title ?? "") + " " + (s.description ?? "") + " " + (s.kind ?? "")).toLowerCase();
    return /valid|review|approbation|controle|contrôle/.test(t);
  });
  if (hasValidationStep) score += 10;
  return Math.max(0, Math.min(100, score));
}

// ─── Décision auto ─────────────────────────────────────────────────────────

function decideAutoStatus(scores: WorkflowScores, sensitive: SensitiveDetectionResult): {
  status: WorkflowQualityReport["auto_status"];
  reasons: string[];
} {
  const reasons: string[] = [];

  // Blocage dur : action critique → revue humaine obligatoire
  if (sensitive.blocking) {
    reasons.push(`Actions sensibles bloquantes (${sensitive.detected.filter((d) => d.severity === "critical" || d.requires_lawyer).map((d) => d.action_label).join(", ")}).`);
    return { status: "pending_human_review", reasons };
  }

  if (
    scores.overall >= 85 &&
    scores.legal_refs >= 80 &&
    scores.safety >= 90 &&
    scores.logic >= 75
  ) {
    reasons.push("Tous les seuils auto-validation atteints.");
    return { status: "ai_validated_auto", reasons };
  }

  if (scores.overall >= 60) {
    reasons.push(`Score global ${scores.overall}/100 → revue humaine recommandée.`);
    return { status: "pending_human_review", reasons };
  }

  reasons.push(`Score global trop faible (${scores.overall}/100) → brouillon IA.`);
  return { status: "draft_ai", reasons };
}

// ─── Orchestrateur ─────────────────────────────────────────────────────────

export async function validateWorkflowDraft(
  draft: WorkflowDraft,
  opts: { tenantId: string; idcc: string | null; apiKey: string },
): Promise<WorkflowQualityReport> {
  const [rerag, consensus, documents, sensitive] = await Promise.all([
    reragSteps(draft, opts.idcc),
    consensusCheck(draft, opts.apiKey),
    checkDocuments(draft, opts.tenantId),
    detectSensitiveActions(draft.steps),
  ]);

  const completeness = completenessScore(draft);
  const safety = safetyScore(sensitive, draft);

  const scores: WorkflowScores = {
    legal_refs: rerag.score,
    logic: consensus.score,
    documents: documents.score,
    completeness,
    safety,
    overall: 0,
  };
  // Pondération : refs 25%, logic 25%, safety 20%, completeness 15%, documents 15%
  scores.overall = Math.round(
    scores.legal_refs * 0.25 +
    scores.logic      * 0.25 +
    scores.safety     * 0.20 +
    scores.completeness * 0.15 +
    scores.documents  * 0.15,
  );

  const decision = decideAutoStatus(scores, sensitive);

  return {
    scores,
    sensitive,
    rerag: { steps_checked: rerag.steps_checked, steps_confirmed: rerag.steps_confirmed, failures: rerag.failures },
    consensus: {
      flash: consensus.flash,
      pro: consensus.pro,
      flash_lite: consensus.flash_lite,
      disagreement: consensus.disagreement,
      agreement_ratio: consensus.agreement_ratio,
    },
    documents,
    auto_status: decision.status,
    reasons: decision.reasons,
  };
}
