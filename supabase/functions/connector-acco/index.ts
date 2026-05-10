// ============================================================================
// CONNECTOR — ACCO (Accords d'entreprise déposés)
// ============================================================================
//
// Source     : data.gouv.fr/datasets/acco-accords-dentreprise
// Producteur : Premier ministre / DILA
// Licence    : Licence Ouverte 2.0
// Volume     : ~66K accords d'entreprise déposés (Décret 2017-752)
// MAJ        : Quotidienne
//
// 2 stratégies d'ingestion :
//   A. API Légifrance via PISTE (rate limited, mais propre) ← STRATÉGIE PAR DÉFAUT
//   B. Téléchargement dump XML (volumineux, sans rate limit)
//
// Pour le MVP : on utilise l'API Légifrance fonds ACCO (chercher des accords
// récents par mots-clés ou par secteur d'activité du tenant).
//
// Pourquoi c'est utile pour ton positionnement PME :
// 1. RH peuvent benchmarker leurs propres accords (télétravail, intéressement)
// 2. Source authority 1.20x (accord négocié, pas une loi mais opposable)
// 3. Filtrable par taille d'entreprise / secteur (SIRET / NAF)
//
// POST body:
//   {
//     mode?: "search" | "recent",
//     query?: string,        // mot-clé (ex: "télétravail", "intéressement")
//     theme?: string,         // thème ACCO normalisé
//     limit?: number,         // défaut 20, max 100
//     dateRange?: "1m" | "3m" | "6m" | "1y"  // défaut "3m"
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

// ─── Endpoints PISTE (Légifrance fonds ACCO) ────────────────────────────────
// Note : ce connector réutilise l'auth OAuth Légifrance (déjà configurée
// dans connector-legifrance via LEGIFRANCE_OAUTH_ID / SECRET).
const PISTE_OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const PISTE_LEGIFRANCE_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";

// ─── Helpers ────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

interface PisteToken {
  access_token: string;
  expires_in: number;
}

async function getPisteToken(): Promise<string> {
  const clientId = Deno.env.get("LEGIFRANCE_OAUTH_ID");
  const clientSecret = Deno.env.get("LEGIFRANCE_OAUTH_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Missing LEGIFRANCE_OAUTH_ID / LEGIFRANCE_OAUTH_SECRET");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "openid",
  });

  const res = await fetch(PISTE_OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`PISTE OAuth failed: HTTP ${res.status}`);
  }

  const data = await res.json() as PisteToken;
  return data.access_token;
}

// ─── Recherche dans le fonds ACCO ───────────────────────────────────────────
interface AccoSearchResult {
  results?: Array<{
    titles?: Array<{ title: string; id: string }>;
    sections?: Array<{ title: string; id: string }>;
    text?: string;
    nature?: string;
    date?: string;
  }>;
  totalResultNumber?: number;
}

interface AccoTextResponse {
  id: string;
  title?: string;
  nature?: string;
  date?: string;
  texte?: string;
  visa?: string;
  notice?: string;
  sections?: Array<{
    title?: string;
    contenu?: string;
    articles?: Array<{
      num?: string;
      content?: string;
    }>;
  }>;
  url?: string;
}

function dateOffsetIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

async function searchAcco(
  token: string,
  query: string | undefined,
  dateStart: string,
  pageSize: number,
): Promise<AccoSearchResult> {
  const url = `${PISTE_LEGIFRANCE_BASE}/search`;

  const payload = {
    fond: "ACCO",
    recherche: {
      filtres: [
        {
          facette: "DATE_SIGNATURE",
          dates: { start: dateStart, end: new Date().toISOString().slice(0, 10) },
        },
      ],
      pageNumber: 1,
      pageSize,
      sort: "SIGNATURE_DATE_DESC",
      typePagination: "ARTICLE",
      ...(query
        ? {
            champs: [
              {
                typeChamp: "TEXTE",
                criteres: [
                  { typeRecherche: "EXACTE", valeur: query, operateur: "ET" },
                ],
                operateur: "ET",
              },
            ],
          }
        : {}),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ACCO search failed: HTTP ${res.status} - ${text.slice(0, 200)}`);
  }

  return await res.json() as AccoSearchResult;
}

async function fetchAccoText(token: string, id: string): Promise<AccoTextResponse> {
  const url = `${PISTE_LEGIFRANCE_BASE}/consult/jorf`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ textCid: id }),
  });

  if (!res.ok) {
    throw new Error(`ACCO text fetch failed: HTTP ${res.status}`);
  }

  return await res.json() as AccoTextResponse;
}

function extractAccoContent(t: AccoTextResponse): string {
  const parts: string[] = [];

  if (t.title) parts.push(`# ${t.title}`);

  if (t.nature) parts.push(`**Nature** : ${t.nature}`);
  if (t.date) parts.push(`**Date de signature** : ${t.date}`);

  if (t.visa) parts.push(`## Visa\n${t.visa}`);
  if (t.notice) parts.push(`## Notice\n${t.notice}`);

  if (t.texte) {
    parts.push(`## Texte de l'accord\n${t.texte}`);
  }

  // Sections / articles si présents
  if (t.sections?.length) {
    for (const sec of t.sections) {
      if (sec.title) parts.push(`### ${sec.title}`);
      if (sec.contenu) parts.push(sec.contenu);
      if (sec.articles?.length) {
        for (const art of sec.articles) {
          if (art.num) parts.push(`**Article ${art.num}**`);
          if (art.content) parts.push(art.content);
        }
      }
    }
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
    mode?: "search" | "recent";
    query?: string;
    theme?: string;
    limit?: number;
    dateRange?: "1m" | "3m" | "6m" | "1y";
  } = {};
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

  const jobId = await startJob(db, "manual", { ...body, connector: "acco" }, userId ?? undefined);

  try {
    const limit = Math.min(body.limit ?? 20, 100);
    const monthsBack = body.dateRange === "1m" ? 1 :
                        body.dateRange === "6m" ? 6 :
                        body.dateRange === "1y" ? 12 : 3;
    const dateStart = dateOffsetIso(monthsBack);

    // 1. Token PISTE
    const token = await getPisteToken();

    // 2. Recherche
    const searchResult = await searchAcco(token, body.query, dateStart, limit);
    const items = searchResult.results ?? [];

    await updateJob(db, jobId, { items_total: items.length });

    let processed = 0;
    let failed = 0;

    // 3. Pour chaque résultat, fetch détail + ingestion
    for (const item of items) {
      const titleEntry = item.titles?.[0];
      if (!titleEntry?.id) continue;

      try {
        const text = await fetchAccoText(token, titleEntry.id);
        const content = extractAccoContent(text);

        if (content.length < 200) continue; // skip vide

        await ingestSource(db, apiKey, "manual", {
          external_id: titleEntry.id,
          source_type: "accord_entreprise",
          title: text.title ?? titleEntry.title.slice(0, 500),
          content,
          reference_code: text.id,
          official_url: text.url ??
            `https://www.legifrance.gouv.fr/jorf/id/${titleEntry.id}`,
          legal_date: text.date ?? null,
          idcc: null,
          raw_metadata: {
            acco_id: titleEntry.id,
            nature: text.nature,
            search_query: body.query ?? null,
            date_range_months: monthsBack,
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
          "manual",
          titleEntry.id ?? "unknown",
          "ingest_error",
          (err as Error).message,
          { connector: "acco", title: titleEntry.title },
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
        total: items.length,
        date_range_months: monthsBack,
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
