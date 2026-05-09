// Connector: Judilibre (jurisprudence Cour de cassation) via PISTE.
// Auth: simple KeyId header (NOT OAuth like Légifrance).
//
// POST body: {
//   chamber?: string[],   // ["soc", "com", ...]
//   date_start?: "YYYY-MM-DD",
//   date_end?: "YYYY-MM-DD",
//   max_decisions?: number,
//   query?: string,
//   dry_run?: boolean
// }
//
// Requires secret: JUDILIBRE_KEY_ID.

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

const JUDILIBRE_BASE = "https://api.piste.gouv.fr/cassation/judilibre/v1.0";
const JUDILIBRE_SANDBOX = "https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0";

function base(): string {
  return Deno.env.get("PISTE_SANDBOX") === "1" ? JUDILIBRE_SANDBOX : JUDILIBRE_BASE;
}

interface SearchResult {
  total: number;
  results?: Array<{
    id: string;
    chamber?: string;
    formation?: string;
    decision_date?: string;
    number?: string;
    solution?: string;
    summary?: string;
    text?: string;
    themes?: string[];
  }>;
  result?: Array<{
    id: string;
    chamber?: string;
    formation?: string;
    decision_date?: string;
    number?: string;
    solution?: string;
    summary?: string;
    text?: string;
    themes?: string[];
  }>;
}

interface DecisionResult {
  id: string;
  text?: string;
  summary?: string;
  decision_date?: string;
  number?: string;
  chamber?: string;
  themes?: string[];
}

const CHAMBER_ALIASES: Record<string, string> = {
  com: "comm",
};

function normalizeChambers(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : ["soc", "comm"];
  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => CHAMBER_ALIASES[value] ?? value);
}

async function judilibreGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = Deno.env.get("PISTE_API_KEY") ?? Deno.env.get("JUDILIBRE_KEY_ID");
  if (!key) {
    throw new Error(
      "PISTE_API_KEY manquant. Ajoutez la clé API PISTE (UUID visible dans la console PISTE) dans les secrets Supabase.",
    );
  }
  const url = `${base()}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: { KeyId: key, apikey: key, Accept: "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Judilibre ${path} ${res.status}: ${txt.slice(0, 300)}`);
  }
  return await res.json() as T;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({}));
    const chambers = normalizeChambers(body.chamber);
    const dateStart: string = body.date_start ?? defaultDateStart();
    const dateEnd: string = body.date_end ?? new Date().toISOString().slice(0, 10);
    const maxDecisions = Math.min(Number(body.max_decisions) || 1000, 10000);
    const query: string = typeof body.query === "string" && body.query.trim().length > 0
      ? body.query.trim()
      : "contrat";
    const dryRun: boolean = body.dry_run === true;

    const db = getAdminClient();
    const apiKey = getLovableApiKey();
    const jobId = await startJob(db, "judilibre", {
      chambers, date_start: dateStart, date_end: dateEnd, max_decisions: maxDecisions,
    });

    // Paginate search
    const collected: SearchResult["results"] = [];
    let page = 0;
    const pageSize = 50;

    try {
      while (collected.length < maxDecisions) {
        const params: Record<string, string> = {
          query,
          page: String(page),
          page_size: String(pageSize),
          date_start: dateStart,
          date_end: dateEnd,
        };
        chambers.forEach((c, i) => params[`chamber${i === 0 ? "" : "_" + i}`] = c);
        // Judilibre uses repeated `chamber` query parameter — simpler approach:
        const url = `${base()}/search?` +
          new URLSearchParams({
            query, page: String(page), page_size: String(pageSize),
            date_start: dateStart, date_end: dateEnd,
          }).toString() +
          chambers.map((c) => `&chamber=${c}`).join("");

        const key = (Deno.env.get("PISTE_API_KEY") ?? Deno.env.get("JUDILIBRE_KEY_ID"))!;
        const res = await fetch(url, { headers: { KeyId: key, apikey: key, Accept: "application/json" } });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Judilibre /search ${res.status}: ${txt.slice(0, 200) || "empty body"}`);
        }
        const data = await res.json() as SearchResult;
        const pageResults = data.results ?? data.result ?? [];
        if (pageResults.length === 0) break;
        collected.push(...pageResults);
        if (pageResults.length < pageSize) break;
        page++;
      }
    } catch (err) {
      await logError(db, jobId, "judilibre", null, "search_error", (err as Error).message);
      await finishJob(db, jobId, "failed");
      return jsonResponse({
        error: (err as Error).message,
        hint: "Vérifiez le secret JUDILIBRE_KEY_ID dans Supabase et que votre application PISTE est bien souscrite à Judilibre.",
      }, 500, corsHeaders);
    }

    const target = collected.slice(0, maxDecisions);
    await updateJob(db, jobId, { items_total: target.length });

    if (dryRun) {
      await finishJob(db, jobId, "completed", { items_processed: 0 });
      return jsonResponse({ job_id: jobId, dry_run: true, found: target.length }, 200, corsHeaders);
    }

    // Ingest each decision (fetch full text if not in search hit)
    let processed = 0;
    let failed = 0;
    for (const hit of target) {
      try {
        let text = hit.text ?? "";
        if (!text) {
          const det = await judilibreGet<DecisionResult>(`/decision`, { id: hit.id });
          text = det.text ?? det.summary ?? "";
        }
        if (!text || text.length < 50) continue;

        await ingestSource(db, apiKey, "judilibre", {
          external_id: hit.id,
          source_type: "jurisprudence",
          title: `Cass. ${hit.chamber ?? ""} ${hit.decision_date ?? ""} — ${hit.number ?? hit.id}`.trim(),
          content: text,
          reference_code: hit.number ?? null,
          official_url: `https://www.courdecassation.fr/decision/${hit.id}`,
          legal_date: hit.decision_date ?? null,
          raw_metadata: {
            chamber: hit.chamber,
            formation: hit.formation,
            solution: hit.solution,
            themes: hit.themes,
          },
        });
        processed++;
        if (processed % 25 === 0) {
          await updateJob(db, jobId, { items_processed: processed });
        }
      } catch (err) {
        failed++;
        await logError(db, jobId, "judilibre", hit.id, "decision_ingest_error",
          (err as Error).message);
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    await finishJob(db, jobId, "completed", {
      items_processed: processed,
      items_failed: failed,
    });
    return jsonResponse({ job_id: jobId, processed, failed, total: target.length }, 200, corsHeaders);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return jsonResponse({ error: (err as Error).message }, 500, corsHeaders);
  }
});

function defaultDateStart(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

function jsonResponse(body: unknown, status: number, corsHeaders: Record<string,string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
