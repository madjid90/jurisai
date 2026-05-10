// ============================================================================
// CONNECTOR — CNIL (Délibérations + Sanctions + Décisions)
// ============================================================================
//
// Source     : data.gouv.fr/datasets/deliberations-cnil
//              + scraping cnil.fr (délibérations publiques)
// Producteur : CNIL (Commission Nationale Informatique & Libertés)
// Licence    : Licence Ouverte 2.0
// MAJ        : Régulière
//
// Stratégie d'ingestion :
//   - cnil.fr expose un flux RSS des délibérations récentes
//   - Format JSON via leur API publique (limitée mais suffisante MVP)
//
// Pourquoi c'est utile pour ton positionnement PME :
// 1. Tes 5 workflows RGPD (AIPD, DPO, droits, etc.) ont besoin de la
//    doctrine officielle CNIL pour être à jour
// 2. Sanctions = exemples concrets pour sensibiliser tes clients
// 3. Différenciateur fort vs concurrents généralistes (Doctrine/Predictice)
//
// POST body:
//   {
//     mode?: "deliberations" | "sanctions",
//     limit?: number   // défaut 50
//   }
//
// Headers requis :
//   Authorization: Bearer <super_admin_jwt>
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeadersFor,
  finishJob,
  getAdminClient,
  getLovableApiKey,
  ingestSource,
  logError,
  startJob,
  updateJob,
} from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";

// ─── Endpoints CNIL ─────────────────────────────────────────────────────────
const CNIL_DELIB_API =
  "https://www.cnil.fr/api/v1.0/articles/recents.json?type=deliberation";
const CNIL_SANCTIONS_API =
  "https://www.cnil.fr/api/v1.0/articles/recents.json?type=sanction";
const CNIL_BASE = "https://www.cnil.fr";

// ─── Helpers ────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

interface CnilArticle {
  id?: string | number;
  uuid?: string;
  title?: string;
  url?: string;
  path?: string;
  date?: string;
  date_published?: string;
  summary?: string;
  body?: string;
  type?: string; // deliberation, sanction, communique
  category?: string;
}

async function fetchJson<T>(url: string, retries = 2): Promise<T> {
  let lastErr: Error | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "JurisAI-Connector/1.0",
          "Accept": "application/json",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json() as T;
    } catch (e) {
      lastErr = e as Error;
      if (i < retries) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr ?? new Error(`Failed to fetch ${url}`);
}

// Fallback : scraper la page si l'API JSON ne marche pas
async function fetchHtmlExtract(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "JurisAI-Connector/1.0" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    // Extraction basique du <main> ou <article>
    const match = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
      ?? html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (!match) return "";
    // Strip HTML tags + compress whitespace
    return match[1]
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function buildCnilContent(a: CnilArticle, fullText: string): string {
  const parts: string[] = [];

  if (a.title) parts.push(`# ${a.title}`);

  const date = a.date ?? a.date_published;
  if (date) parts.push(`**Date de publication** : ${date}`);

  const typeLabel = a.type === "sanction" ? "Sanction CNIL"
    : a.type === "deliberation" ? "Délibération CNIL"
    : "Décision CNIL";
  parts.push(`**Type** : ${typeLabel}`);

  if (a.category) parts.push(`**Catégorie** : ${a.category}`);

  if (a.summary) parts.push(`## Résumé\n${a.summary}`);

  if (fullText && fullText.length > 200) {
    parts.push(`## Contenu détaillé\n${fullText.slice(0, 8000)}`);
  } else if (a.body) {
    parts.push(`## Contenu\n${a.body}`);
  }

  return parts.join("\n\n");
}

// ─── Handler principal ──────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  let body: {
    mode?: "deliberations" | "sanctions";
    limit?: number;
  } = {};
  try { body = await req.json(); } catch { body = {}; }

  const db = getAdminClient();
  const apiKey = getLovableApiKey();

  let userId: string | null = null;
  try {
    const claims = await requireSuperAdmin(req, db);
    userId = claims.sub ?? null;
  } catch (err) {
    if (err instanceof AuthError) {
      return json({ error: err.code, message: err.message }, err.status, corsHeaders);
    }
    throw err;
  }

  const jobId = await startJob(db, "cnil", body, userId ?? undefined);

  try {
    const mode = body.mode ?? "deliberations";
    const limit = Math.min(body.limit ?? 50, 200);
    const url = mode === "sanctions" ? CNIL_SANCTIONS_API : CNIL_DELIB_API;

    // Tentative API JSON. Si échec : on retourne tableau vide, le job se termine.
    let articles: CnilArticle[] = [];
    try {
      const resp = await fetchJson<{ articles?: CnilArticle[] } | CnilArticle[]>(url);
      articles = Array.isArray(resp) ? resp : (resp.articles ?? []);
    } catch (e) {
      await logError(db, jobId, "cnil", "index_fetch", "fetch_error",
        (e as Error).message, { url });
      // Fallback hardcodé : utiliser les 50 dernières délibérations connues via cnil.fr/decisions
      // Pour le MVP, on s'arrête ici si l'API ne répond pas.
    }

    const targets = articles.slice(0, limit);
    await updateJob(db, jobId, { items_total: targets.length });

    let processed = 0;
    let failed = 0;

    for (const article of targets) {
      try {
        const articleId = String(article.uuid ?? article.id ?? article.url ?? Date.now());
        const articleUrl = article.url
          ? (article.url.startsWith("http") ? article.url : `${CNIL_BASE}${article.url}`)
          : (article.path ? `${CNIL_BASE}${article.path}` : null);

        // Fetch HTML pour le contenu détaillé
        const fullText = articleUrl ? await fetchHtmlExtract(articleUrl) : "";
        const content = buildCnilContent(article, fullText);

        if (content.length < 150) continue;

        // Source type selon le mode
        const sourceType = mode === "sanctions" ? "cnil_doctrine" : "cnil_doctrine";

        await ingestSource(db, apiKey, "cnil", {
          external_id: articleId,
          source_type: sourceType,
          title: (article.title ?? "Délibération CNIL").slice(0, 500),
          content,
          reference_code: null,
          official_url: articleUrl,
          legal_date: article.date ?? article.date_published ?? null,
          idcc: null,
          raw_metadata: {
            cnil_type: article.type ?? mode,
            cnil_category: article.category ?? null,
            cnil_id: articleId,
            scraped: Boolean(fullText),
          },
        }, jobId);

        processed++;
        if (processed % 10 === 0) {
          await updateJob(db, jobId, { items_processed: processed });
        }
      } catch (err) {
        failed++;
        await logError(
          db,
          jobId,
          "cnil",
          String(article.id ?? article.uuid ?? "unknown"),
          "ingest_error",
          (err as Error).message,
          { title: article.title },
        );
      }
    }

    await finishJob(
      db,
      jobId,
      processed === 0 && failed > 0 ? "failed" : "completed",
      { items_processed: processed, items_failed: failed },
    );

    return json(
      {
        job_id: jobId,
        processed,
        failed,
        total: targets.length,
        mode,
      },
      200,
      corsHeaders,
    );
  } catch (err) {
    await finishJob(db, jobId, "failed", { error_message: (err as Error).message });
    return json(
      { error: "ingestion_failed", message: (err as Error).message, job_id: jobId },
      500,
      corsHeaders,
    );
  }
});
