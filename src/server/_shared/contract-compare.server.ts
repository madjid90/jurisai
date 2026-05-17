// Comparateur de contrats — diff sémantique entre deux documents.
// Utilisé comme outil agent (compare_contracts) ET comme server function exposée.
//
// Principe : on charge les 2 documents, on tronque, on envoie au LLM avec un
// prompt spécialisé droit des contrats français, et on parse le JSON retourné.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { llmFetch } from "./llm-fetch.server";
import { AI_GATEWAY, LLM_API_KEY, LLM_TEMPERATURES, LLM_MAX_TOKENS } from "./constants.server";
import { resolveChatModel } from "./llm-models.server";
import { safeParseJSON } from "./agent-tools.server";
import { sanitizePromptInput } from "./prompt-sanitizer.server";

const MAX_DOC_CHARS = 15_000;

export type ContractDiffClause = {
  title: string;
  excerpt_a?: string;
  excerpt_b?: string;
  change_summary?: string;
};

export type ContractRisk = {
  title: string;
  severity: "low" | "medium" | "high";
  description: string;
  legal_basis?: string;
};

export type ContractCompareResult = {
  executive_summary: string;
  only_in_a: ContractDiffClause[];
  only_in_b: ContractDiffClause[];
  modified_clauses: ContractDiffClause[];
  risks: ContractRisk[];
  global_risk: "low" | "medium" | "high";
  global_risk_rationale: string;
  recommendations: string[];
};

const COMPARE_SYSTEM = `Tu es un juriste-expert français spécialiste du droit des contrats (commercial, travail, RGPD, sociétés).
Tu compares deux documents contractuels et produis un audit structuré en JSON STRICT.

RÈGLES :
- Compare le SENS et les effets juridiques, pas le texte mot-à-mot.
- Identifie les clauses risquées en droit français (non-concurrence sans contrepartie financière, clause de mobilité géographique trop large, période d'essai supérieure au plafond légal, clause pénale manifestement excessive, clause de non-sollicitation déguisée, clauses abusives au sens L.212-1 C. conso, etc.).
- Cite les fondements légaux quand pertinent (article du Code).
- Sois précis et factuel. Pas de remplissage.

Format de sortie OBLIGATOIRE (JSON pur, pas de markdown) :
{
  "executive_summary": "3 lignes max",
  "only_in_a": [{ "title": "Nom de la clause", "excerpt_a": "extrait court", "change_summary": "pourquoi c'est notable" }],
  "only_in_b": [{ "title": "...", "excerpt_b": "...", "change_summary": "..." }],
  "modified_clauses": [{ "title": "...", "excerpt_a": "...", "excerpt_b": "...", "change_summary": "..." }],
  "risks": [{ "title": "...", "severity": "low|medium|high", "description": "...", "legal_basis": "art. L... C. trav." }],
  "global_risk": "low|medium|high",
  "global_risk_rationale": "1-2 phrases",
  "recommendations": ["action 1", "action 2", ...]
}`;

export type CompareCtx = {
  tenantId: string;
  apiKey?: string;
};

export async function compareContracts(params: {
  docAId: string;
  docBId: string;
  ctx: CompareCtx;
}): Promise<ContractCompareResult> {
  const { docAId, docBId, ctx } = params;
  if (!docAId || !docBId) throw new Error("doc_a_id et doc_b_id sont requis");
  if (docAId === docBId) throw new Error("Les deux documents doivent être différents");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data: docs, error } = await sb
    .from("documents")
    .select("id, title, content, tenant_id")
    .in("id", [docAId, docBId])
    .eq("tenant_id", ctx.tenantId);

  if (error) throw new Error(`Lecture documents impossible : ${error.message}`);
  if (!docs || docs.length < 2) {
    throw new Error("Un ou plusieurs documents introuvables (ou hors tenant)");
  }

  const docA = docs.find((d: { id: string }) => d.id === docAId);
  const docB = docs.find((d: { id: string }) => d.id === docBId);
  if (!docA || !docB) throw new Error("Documents non trouvés");

  const contentA = (docA.content ?? "").toString().trim();
  const contentB = (docB.content ?? "").toString().trim();
  if (!contentA) throw new Error(`Document A (${docA.title ?? docAId}) n'a pas de contenu textuel extrait`);
  if (!contentB) throw new Error(`Document B (${docB.title ?? docBId}) n'a pas de contenu textuel extrait`);

  const truncatedA = sanitizePromptInput(contentA.slice(0, MAX_DOC_CHARS));
  const truncatedB = sanitizePromptInput(contentB.slice(0, MAX_DOC_CHARS));

  const apiKey = ctx.apiKey ?? LLM_API_KEY;
  if (!apiKey) throw new Error("Clé API LLM manquante");

  const model = await resolveChatModel(ctx.tenantId);

  const userMsg = `Document A — "${docA.title ?? "(sans titre)"}":
"""
${truncatedA}
"""

Document B — "${docB.title ?? "(sans titre)"}":
"""
${truncatedB}
"""

Produis l'audit JSON.`;

  const res = await llmFetch(`${AI_GATEWAY}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: LLM_TEMPERATURES.chat,
      max_tokens: LLM_MAX_TOKENS.chat,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: COMPARE_SYSTEM },
        { role: "user", content: userMsg },
      ],
    }),
  }, { breakerModel: model });

  if (!res.ok) throw new Error(`LLM ${res.status} sur compare_contracts`);
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = safeParseJSON(raw) as Partial<ContractCompareResult>;

  // Normalisation défensive
  const normSev = (s: unknown): "low" | "medium" | "high" => {
    const v = String(s ?? "medium").toLowerCase();
    return v === "low" || v === "high" ? v : "medium";
  };

  return {
    executive_summary: String(parsed.executive_summary ?? "—"),
    only_in_a: Array.isArray(parsed.only_in_a) ? parsed.only_in_a : [],
    only_in_b: Array.isArray(parsed.only_in_b) ? parsed.only_in_b : [],
    modified_clauses: Array.isArray(parsed.modified_clauses) ? parsed.modified_clauses : [],
    risks: Array.isArray(parsed.risks)
      ? parsed.risks.map((r) => ({
          title: String(r.title ?? ""),
          severity: normSev(r.severity),
          description: String(r.description ?? ""),
          legal_basis: r.legal_basis ? String(r.legal_basis) : undefined,
        }))
      : [],
    global_risk: normSev(parsed.global_risk),
    global_risk_rationale: String(parsed.global_risk_rationale ?? ""),
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map(String)
      : [],
  };
}
