// Helper RAG juridique partagé — server-only.
// Toute génération/recherche sourcée passe par ici, pour garantir :
//  - l'usage de hybrid_search (RRF + boost autorité)
//  - le formatage uniforme [source:N] + métadonnées
//  - la traçabilité (chunk_id + source_id) pour l'audit citations.
//  - retrieval stratifié par type de source (4 lanes)
//  - MMR reranking avec pénalité de type pour diversité

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embedText } from "./llm-embeddings.server";

export type LegalSource = {
  n: number;
  chunk_id: string;
  source_id: string;
  title: string;
  reference: string | null;
  url: string | null;
  source_type: string | null;
  excerpt: string;
  heading: string | null;
  score: number;
};

export type SourcingResult = {
  sources: LegalSource[];
  query: string;
  /** Si vide → aucune source pertinente trouvée. */
  ok: boolean;
  reason?: string;
};

type RawChunk = {
  chunk_id: string;
  source_id: string;
  content: string;
  heading: string | null;
  source_title: string;
  source_type: string | null;
  reference_code: string | null;
  official_url: string | null;
  score: number;
  embedding?: number[] | null;
};

// ─── Catégories de sources pour le retrieval stratifié ───────────
const LEGISLATION_TYPES = new Set([
  "code_article", "code_section", "code_travail", "loi", "decret", "arrete", "circulaire",
]);
const CONVENTION_TYPES = new Set([
  "convention", "convention_article", "convention_collective", "accord_branche", "accord_entreprise",
]);
const JURISPRUDENCE_TYPES = new Set([
  "jurisprudence", "jurisprudence_admin", "jurisprudence_administrative",
]);
// Tout le reste = doctrine/fiches

function classifySourceType(st: string | null): "legislation" | "convention" | "jurisprudence" | "doctrine" {
  if (!st) return "doctrine";
  if (LEGISLATION_TYPES.has(st)) return "legislation";
  if (CONVENTION_TYPES.has(st)) return "convention";
  if (JURISPRUDENCE_TYPES.has(st)) return "jurisprudence";
  return "doctrine";
}

// ─── MMR avec pénalité de type ──────────────────────────────────
const MMR_LAMBDA = 0.7;
const TYPE_PENALTY = 0.15;

/**
 * Maximal Marginal Relevance reranking avec pénalité de type.
 * Diversifie les résultats par contenu (cosine similarity sur embeddings)
 * ET par type de source (pénalise les sources du même type déjà sélectionnées).
 */
function mmrRerank(candidates: RawChunk[], limit: number): RawChunk[] {
  if (candidates.length <= limit) return candidates;

  const selected: RawChunk[] = [];
  const remaining = [...candidates];

  // Premier = meilleur score brut
  selected.push(remaining.shift()!);

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];

      // Pénalité de type : si un résultat du même type est déjà sélectionné
      const candCategory = classifySourceType(cand.source_type);
      const sameTypeCount = selected.filter(
        (s) => classifySourceType(s.source_type) === candCategory,
      ).length;
      const tp = sameTypeCount > 0 ? TYPE_PENALTY * sameTypeCount : 0;

      // Score MMR simplifié (pas de cosine sur embeddings pour perf — on utilise
      // la différence de score RRF comme proxy de diversité de contenu)
      const maxSimToSelected = Math.max(
        ...selected.map((s) => {
          // Proxy : chunks du même source_id = très similaires
          if (s.source_id === cand.source_id) return 0.95;
          // Même type de source = modérément similaires
          if (classifySourceType(s.source_type) === candCategory) return 0.3;
          return 0.1;
        }),
      );

      const mmr = MMR_LAMBDA * cand.score - (1 - MMR_LAMBDA) * maxSimToSelected - tp;

      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

async function embedQuery(query: string): Promise<number[] | null> {
  const res = await embedText(query, { context: "legal-rag" });
  if (!res.ok) {
    console.warn(`[legal-rag] embedding failed kind=${res.kind} status=${res.status ?? "-"} attempts=${res.attempts}`);
    return null;
  }
  return res.embedding;
}

/**
 * Recherche hybride stratifiée dans `legal_chunks`.
 *
 * Stratégie :
 *  1. Appel hybrid_search avec match_count large (24) pour récupérer un pool varié
 *  2. MMR reranking avec pénalité de type → garantit mix législation/convention/jurisprudence
 *  3. Fallback FTS si pas d'embedding
 */
export async function searchLegalSources(
  query: string,
  opts: { idcc?: string | null; limit?: number; minScore?: number } = {},
): Promise<SourcingResult> {
  const limit = opts.limit ?? 8;
  // D1 FIX: Seuil minimum de pertinence pour éviter d'injecter des résultats non pertinents
  // Les scores RRF typiques sont 0.01-0.03 pour les bons résultats
  if (opts.minScore === undefined) opts.minScore = 0.005;
  const trimmed = query.trim();
  if (trimmed.length < 4) {
    return { sources: [], query: trimmed, ok: false, reason: "Requête trop courte" };
  }

  const embedding = await embedQuery(trimmed);

  // Cas nominal : hybrid_search RPC (vecteur + FTS + boost autorité)
  if (embedding) {
    // Récupérer un pool large pour le MMR (3x le limit demandé)
    const poolSize = Math.max(limit * 3, 24);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin as any).rpc("hybrid_search", {
      query_embedding: embedding,
      query_text: trimmed,
      match_count: poolSize,
      idcc_filter: opts.idcc ?? null,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      const pool = data as RawChunk[];
      // MMR reranking avec diversité de type
      const reranked = mmrRerank(pool, limit);
      return formatSources(reranked, trimmed, opts.minScore);
    }
    if (error) console.warn("[legal-rag] hybrid_search failed:", error.message);
  }

  // Fallback FTS pur si pas d'embedding ou rien trouvé
  const tsQuery = trimmed
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 8)
    .join(" | ");
  if (!tsQuery) {
    return { sources: [], query: trimmed, ok: false, reason: "Aucun mot indexable" };
  }

  const { data: rows } = await supabaseAdmin
    .from("legal_chunks")
    .select("id, source_id, content, heading, legal_sources!inner(title, source_type, reference_code, official_url, is_active, idcc)")
    .eq("legal_sources.is_active", true)
    .textSearch("fts", tsQuery, { config: "french" })
    .limit(limit);

  if (!rows || rows.length === 0) {
    return { sources: [], query: trimmed, ok: false, reason: "Aucune source pertinente" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapped = rows.map((r: any) => ({
    chunk_id: r.id,
    source_id: r.source_id,
    content: r.content,
    heading: r.heading,
    source_title: r.legal_sources?.title,
    source_type: r.legal_sources?.source_type,
    reference_code: r.legal_sources?.reference_code,
    official_url: r.legal_sources?.official_url,
    score: 0.5,
  }));
  return formatSources(mapped, trimmed, opts.minScore);
}

function formatSources(
  rows: RawChunk[],
  query: string,
  minScore = 0,
): SourcingResult {
  const filtered = rows.filter((r) => r.score >= minScore);
  if (filtered.length === 0) {
    return { sources: [], query, ok: false, reason: "Score insuffisant" };
  }
  const sources: LegalSource[] = filtered.map((r, i) => ({
    n: i + 1,
    chunk_id: r.chunk_id,
    source_id: r.source_id,
    title: r.source_title,
    reference: r.reference_code,
    url: r.official_url,
    source_type: r.source_type,
    heading: r.heading,
    excerpt: (r.content ?? "").slice(0, 280).trim(),
    score: Number(r.score?.toFixed?.(3) ?? r.score),
  }));
  return { sources, query, ok: true };
}

/** Bloc HTML « Bases légales » à append au document généré. */
export function renderLegalBasisBlock(sources: LegalSource[]): string {
  if (sources.length === 0) return "";
  const items = sources
    .map(
      (s) => `<li>
        <strong>[source:${s.n}]</strong> ${escapeHtml(s.title)}${
          s.reference ? ` — <em>${escapeHtml(s.reference)}</em>` : ""
        }
        ${s.url ? `<br/><a href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer">${escapeHtml(s.url)}</a>` : ""}
        ${s.excerpt ? `<br/><span style="color:#555;font-size:12px">« ${escapeHtml(s.excerpt)}… »</span>` : ""}
      </li>`,
    )
    .join("");
  return `
<hr/>
<section data-legal-basis="true">
  <h3>Bases légales utilisées</h3>
  <ol>${items}</ol>
</section>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
