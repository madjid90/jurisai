// ============================================================================
// CONNECTOR — DOLE (Dossiers législatifs - lois en préparation)
// ============================================================================
//
// Source     : data.gouv.fr/datasets/dole-les-dossiers-legislatifs
// Producteur : Premier ministre / DILA
// Licence    : Licence Ouverte 2.0
// Volume     : Tous les dossiers législatifs depuis 2002 (XIIe législature)
// MAJ        : Quotidienne
//
// API        : Légifrance fonds JORF/LEGI via PISTE
//
// Pourquoi c'est un connecteur DIFFÉRENCIATEUR pour JurisAI :
// 1. Veille PROACTIVE : connaître les lois EN PRÉPARATION
//    (avant même qu'elles s'appliquent)
// 2. Pas un autre concurrent ne propose ça aux PME
//    (Predictice/Doctrine se concentrent sur les textes déjà publiés)
// 3. Intégration parfaite avec ton système legal_alerts existant
//
// POST body:
//   {
//     mode?: "recent" | "in_progress",
//     limit?: number,        // défaut 30
//     dateRange?: "1m" | "3m" | "6m"  // défaut "3m"
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

const PISTE_OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const PISTE_LEGIFRANCE_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";

// ─── Helpers ────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function dateOffsetIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

interface PisteToken { access_token: string; expires_in: number; }

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

  if (!res.ok) throw new Error(`PISTE OAuth failed: HTTP ${res.status}`);
  const data = await res.json() as PisteToken;
  return data.access_token;
}

// ─── Recherche dans le fonds DOLE ───────────────────────────────────────────
interface DoleSearchResult {
  results?: Array<{
    titles?: Array<{ title: string; id: string }>;
    nature?: string;
    date?: string;
    text?: string;
  }>;
  totalResultNumber?: number;
}

interface DoleDossier {
  id: string;
  titre?: string;
  titrePrincipal?: string;
  natureLoi?: string; // PROJET_LOI, PROPOSITION_LOI, ORDONNANCE
  legislature?: string;
  resume?: string;
  exposeMotifs?: string;
  procedureParlementaire?: string;
  evenements?: Array<{
    date?: string;
    typeEvenement?: string;
    titre?: string;
    description?: string;
  }>;
  documents?: Array<{
    id?: string;
    titre?: string;
    type?: string;
    url?: string;
  }>;
  url?: string;
}

async function searchDole(
  token: string,
  dateStart: string,
  pageSize: number,
): Promise<DoleSearchResult> {
  const url = `${PISTE_LEGIFRANCE_BASE}/search`;

  const payload = {
    fond: "LODA_DATE",
    recherche: {
      filtres: [
        {
          facette: "TEXT_LEGAL_STATUS",
          valeurs: ["VIGUEUR", "VIGUEUR_DIFF"],
        },
        {
          facette: "DATE_VERSION",
          dates: { start: dateStart, end: new Date().toISOString().slice(0, 10) },
        },
      ],
      pageNumber: 1,
      pageSize,
      sort: "PUBLICATION_DATE_DESC",
      typePagination: "DEFAUT",
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
    throw new Error(`DOLE search failed: HTTP ${res.status} - ${text.slice(0, 200)}`);
  }

  return await res.json() as DoleSearchResult;
}

async function fetchDoleDossier(token: string, id: string): Promise<DoleDossier> {
  const url = `${PISTE_LEGIFRANCE_BASE}/consult/legiPart`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ textId: id, date: new Date().toISOString().slice(0, 10) }),
  });

  if (!res.ok) {
    throw new Error(`DOLE dossier fetch failed: HTTP ${res.status}`);
  }

  return await res.json() as DoleDossier;
}

function extractDoleContent(d: DoleDossier): string {
  const parts: string[] = [];

  const title = d.titrePrincipal ?? d.titre ?? "Dossier législatif";
  parts.push(`# ${title}`);

  if (d.natureLoi) {
    const natureLabel = d.natureLoi === "PROJET_LOI" ? "Projet de loi"
      : d.natureLoi === "PROPOSITION_LOI" ? "Proposition de loi"
      : d.natureLoi === "ORDONNANCE" ? "Ordonnance"
      : d.natureLoi;
    parts.push(`**Nature** : ${natureLabel}`);
  }

  if (d.legislature) parts.push(`**Législature** : ${d.legislature}`);

  if (d.resume) parts.push(`## Résumé\n${d.resume}`);
  if (d.exposeMotifs) parts.push(`## Exposé des motifs\n${d.exposeMotifs}`);
  if (d.procedureParlementaire) {
    parts.push(`## Procédure parlementaire\n${d.procedureParlementaire}`);
  }

  // Chronologie des événements
  if (d.evenements?.length) {
    parts.push(`## Chronologie`);
    for (const ev of d.evenements.slice(0, 20)) {
      const date = ev.date ? `${ev.date} — ` : "";
      const type = ev.typeEvenement ?? "";
      const titre = ev.titre ?? "";
      parts.push(`- ${date}${type} : ${titre}`);
      if (ev.description) parts.push(`  ${ev.description}`);
    }
  }

  // Documents associés (texte, rapports, amendements)
  if (d.documents?.length) {
    parts.push(`## Documents associés`);
    for (const doc of d.documents.slice(0, 15)) {
      const titre = doc.titre ?? "Document";
      const type = doc.type ? ` (${doc.type})` : "";
      const lien = doc.url ? ` — [Lien](${doc.url})` : "";
      parts.push(`- ${titre}${type}${lien}`);
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
    mode?: "recent" | "in_progress";
    limit?: number;
    dateRange?: "1m" | "3m" | "6m";
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

  const jobId = await startJob(db, "manual", { ...body, connector: "dole" }, userId ?? undefined);

  try {
    const limit = Math.min(body.limit ?? 30, 100);
    const monthsBack = body.dateRange === "1m" ? 1 :
                        body.dateRange === "6m" ? 6 : 3;
    const dateStart = dateOffsetIso(monthsBack);

    const token = await getPisteToken();
    const searchResult = await searchDole(token, dateStart, limit);
    const items = searchResult.results ?? [];

    await updateJob(db, jobId, { items_total: items.length });

    let processed = 0;
    let failed = 0;

    for (const item of items) {
      const titleEntry = item.titles?.[0];
      if (!titleEntry?.id) continue;

      try {
        const dossier = await fetchDoleDossier(token, titleEntry.id);
        const content = extractDoleContent(dossier);

        if (content.length < 200) continue;

        await ingestSource(db, apiKey, "manual", {
          external_id: titleEntry.id,
          source_type: "dossier_legislatif",
          title: (dossier.titrePrincipal ?? dossier.titre ?? titleEntry.title).slice(0, 500),
          content,
          reference_code: dossier.id,
          official_url: dossier.url ??
            `https://www.legifrance.gouv.fr/dossierlegislatif/${titleEntry.id}`,
          legal_date: item.date ?? null,
          idcc: null,
          raw_metadata: {
            dole_id: titleEntry.id,
            nature: dossier.natureLoi,
            legislature: dossier.legislature,
            events_count: dossier.evenements?.length ?? 0,
            documents_count: dossier.documents?.length ?? 0,
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
          { connector: "dole", title: titleEntry.title },
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
    await finishJob(db, jobId, "failed", { error_message: (err as Error).message });
    return json(
      { error: "ingestion_failed", message: (err as Error).message, job_id: jobId },
      500,
      corsHeaders,
    );
  }
});
