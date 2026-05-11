// Helper RAG juridique partagé — server-only.
// Toute génération/recherche sourcée passe par ici, pour garantir :
//  - l'usage de hybrid_search (RRF + boost autorité)
//  - le formatage uniforme [source:N] + métadonnées
//  - la traçabilité (chunk_id + source_id) pour l'audit citations.

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

async function embedQuery(query: string): Promise<number[] | null> {
  const res = await embedText(query, { context: "legal-rag" });
  if (!res.ok) {
    console.warn(`[legal-rag] embedding failed kind=${res.kind} status=${res.status ?? "-"} attempts=${res.attempts}`);
    return null;
  }
  return res.embedding;
}

/**
 * Recherche hybride dans `legal_chunks`.
 * Utilise la fonction Postgres `hybrid_search` (RRF + boost autorité) si
 * un embedding est disponible, sinon fallback FTS uniquement.
 */
export async function searchLegalSources(
  query: string,
  opts: { idcc?: string | null; limit?: number; minScore?: number } = {},
): Promise<SourcingResult> {
  const limit = opts.limit ?? 6;
  const trimmed = query.trim();
  if (trimmed.length < 4) {
    return { sources: [], query: trimmed, ok: false, reason: "Requête trop courte" };
  }

  const embedding = await embedQuery(trimmed);

  // Cas nominal : hybrid_search RPC (vecteur + FTS + boost autorité)
  if (embedding) {
    const { data, error } = await (supabaseAdmin as any).rpc("hybrid_search", {
      query_embedding: embedding,
      query_text: trimmed,
      match_count: limit,
      idcc_filter: opts.idcc ?? null,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      return formatSources(data, trimmed, opts.minScore);
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
  rows: Array<{
    chunk_id: string;
    source_id: string;
    content: string;
    heading: string | null;
    source_title: string;
    source_type: string | null;
    reference_code: string | null;
    official_url: string | null;
    score: number;
  }>,
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
