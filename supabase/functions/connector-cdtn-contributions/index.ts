// ============================================================================
// CONNECTOR — CDTN Contributions (Q/R officielles Code du Travail Numérique)
// ============================================================================
//
// Source  : github.com/SocialGouv/contributions-data
// Licence : Licence Ouverte 2.0 (data.gouv.fr)
// Volume  : ~2000 Q/R officielles rédigées par les juristes du Ministère
//           du travail (Code du travail numérique)
// Format  : JSON
// MAJ     : Quotidienne via GitHub
//
// Pourquoi c'est le connecteur LE PLUS RENTABLE pour ton RAG :
// 1. Réponses DÉJÀ rédigées par des juristes officiels
// 2. Format Q/R idéal pour ton agent (similarité forte aux questions users)
// 3. Couvre TOUS les sujets RH PME (licenciement, congés, etc.)
// 4. authority_level 1.20x (pas une loi mais doctrine officielle)
//
// POST body:
//   { mode?: "all" | "limit", limit?: number }
//   Default: mode="all" (charge tout, ~2000 entrées)
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

// ─── Sources GitHub ─────────────────────────────────────────────────────────
const CDTN_INDEX_URL =
  "https://api.github.com/repos/SocialGouv/contributions-data/contents/data/contributions";
const CDTN_RAW_BASE =
  "https://raw.githubusercontent.com/SocialGouv/contributions-data/master/data/contributions";

// ─── Types ──────────────────────────────────────────────────────────────────
interface GhFileEntry {
  name: string;
  path: string;
  sha: string;
  size: number;
  download_url: string;
  type: "file" | "dir";
}

interface CdtnContribution {
  id: string;
  index?: string;
  title: string;
  description?: string;
  references?: Array<{
    title: string;
    url?: string;
    type?: string;
  }>;
  answers?: {
    generic?: {
      text?: string;
      markdown?: string;
      references?: Array<{ title: string; url?: string }>;
    };
    conventions?: Array<{
      idcc: string;
      name?: string;
      markdown?: string;
      references?: Array<{ title: string; url?: string }>;
    }>;
  };
  // Format simplifié alternatif
  content?: string;
  markdown?: string;
}

// ─── Helper : extrait le texte propre d'une contribution ────────────────────
function extractContent(c: CdtnContribution): string {
  const parts: string[] = [];

  // Titre = la question
  parts.push(`# Question\n${c.title}`);

  if (c.description) {
    parts.push(`## Contexte\n${c.description}`);
  }

  // Réponse générique
  const genericText =
    c.answers?.generic?.markdown ??
    c.answers?.generic?.text ??
    c.markdown ??
    c.content ??
    "";

  if (genericText.trim()) {
    parts.push(`## Réponse officielle (Code du Travail Numérique)\n${genericText.trim()}`);
  }

  // Réponses spécifiques par convention collective (résumé)
  if (c.answers?.conventions?.length) {
    const ccCount = c.answers.conventions.length;
    parts.push(`## Spécificités convention collective\n${ccCount} convention(s) collective(s) prévoient des règles spécifiques. Consultez votre IDCC pour les détails.`);
  }

  // Références juridiques
  const refs = [
    ...(c.references ?? []),
    ...(c.answers?.generic?.references ?? []),
  ];
  if (refs.length) {
    const refLines = refs
      .filter((r) => r?.title)
      .slice(0, 10) // cap pour éviter chunks trop longs
      .map((r) => r.url ? `- [${r.title}](${r.url})` : `- ${r.title}`)
      .join("\n");
    if (refLines) {
      parts.push(`## Références juridiques\n${refLines}`);
    }
  }

  return parts.join("\n\n");
}

// ─── HTTP fetch avec retry simple ───────────────────────────────────────────
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
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      return await res.json() as T;
    } catch (e) {
      lastErr = e as Error;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  throw lastErr ?? new Error(`Failed to fetch ${url}`);
}

function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
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

  let body: { mode?: "all" | "limit"; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const db = getAdminClient();
  const apiKey = getLovableApiKey();

  // Auth super admin
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

  const jobId = await startJob(db, "cdtn-modeles", body, userId ?? undefined);

  try {
    // 1. Lister tous les fichiers JSON dans le dossier contributions/
    const files = await fetchJson<GhFileEntry[]>(CDTN_INDEX_URL);
    const jsonFiles = files.filter((f) => f.type === "file" && f.name.endsWith(".json"));

    const limit = body.mode === "limit" && body.limit ? body.limit : jsonFiles.length;
    const targets = jsonFiles.slice(0, limit);

    await updateJob(db, jobId, { items_total: targets.length });

    let processed = 0;
    let failed = 0;

    // 2. Pour chaque fichier, télécharger + ingérer
    for (const file of targets) {
      try {
        const contribution = await fetchJson<CdtnContribution>(
          file.download_url ?? `${CDTN_RAW_BASE}/${file.name}`,
        );

        const content = extractContent(contribution);

        // Skip si pas de réponse réelle
        if (content.length < 100) {
          continue;
        }

        await ingestSource(db, apiKey, "cdtn-modeles", {
          external_id: contribution.id ?? file.sha,
          source_type: "cdtn_question",
          title: contribution.title.slice(0, 500),
          content,
          reference_code: contribution.index ?? null,
          official_url: `https://code.travail.gouv.fr/contribution/${contribution.id}`,
          legal_date: null, // pas de date "légale" pour une Q/R
          idcc: null, // les conventions sont dans answers.conventions
          raw_metadata: {
            cdtn_id: contribution.id,
            file_name: file.name,
            sha: file.sha,
            has_cc_specific: Boolean(contribution.answers?.conventions?.length),
            cc_count: contribution.answers?.conventions?.length ?? 0,
            references_count:
              (contribution.references?.length ?? 0) +
              (contribution.answers?.generic?.references?.length ?? 0),
          },
        }, jobId);

        processed++;
        if (processed % 50 === 0) {
          await updateJob(db, jobId, { items_processed: processed });
        }
      } catch (err) {
        failed++;
        await logError(
          db,
          jobId,
          "cdtn-modeles",
          file.name,
          "ingest_error",
          (err as Error).message,
          { file_path: file.path },
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
      },
      200,
      corsHeaders,
    );
  } catch (err) {
    await finishJob(db, jobId, "failed", {
      error_message: (err as Error).message,
    });
    return json(
      { error: "ingestion_failed", message: (err as Error).message, job_id: jobId },
      500,
      corsHeaders,
    );
  }
});
