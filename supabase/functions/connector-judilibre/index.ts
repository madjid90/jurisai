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
  corsHeaders,
  finishJob,
  getAdminClient,
  getLovableApiKey,
  ingestSource,
  logError,
  startJob,
  updateJob,
} from "../_shared/ingest.ts";

const JUDILIBRE_BASE = "https://api.piste.gouv.fr/cassation/judilibre/v1.0";
const JUDILIBRE_SANDBOX = "https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0";

function base(): string {
  return Deno.env.get("PISTE_SANDBOX") === "1" ? JUDILIBRE_SANDBOX : JUDILIBRE_BASE;
}

interface SearchResult {
  total: number;
  results: Array<{
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

async function judilibreGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = Deno.env.get("JUDILIBRE_KEY_ID");
  if (!key) {
    throw new Error(
      "JUDILIBRE_KEY_ID manquant. Inscrivez-vous sur https://piste.gouv.fr, " +
      "souscrivez l'API Judilibre et ajoutez le secret.",
    );
  }
  const url = `${base()}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: { KeyId: key, Accept: "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Judilibre ${path} ${res.status}: ${txt.slice(0, 300)}`);
  }
  return await res.json() as T;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const chambers: string[] = Array.isArray(body.chamber) ? body.chamber : ["soc", "com"];
    const dateStart: string = body.date_start ?? defaultDateStart();
    const dateEnd: string = body.date_end ?? new Date().toISOString().slice(0, 10);
    const maxDecisions = Math.min(Number(body.max_decisions) || 1000, 10000);
    const query: string = body.query ?? "*";
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

        const key = Deno.env.get("JUDILIBRE_KEY_ID")!;
        const res = await fetch(url, { headers: { KeyId: key, Accept: "application/json" } });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Judilibre /search ${res.status}: ${txt.slice(0, 200)}`);
        }
        const data = await res.json() as SearchResult;
        if (!data.results || data.results.length === 0) break;
        collected.push(...data.results);
        if (data.results.length < pageSize) break;
        page++;
      }
    } catch (err) {
      await logError(db, jobId, "judilibre", null, "search_error", (err as Error).message);
      await finishJob(db, jobId, "failed");
      return jsonResponse({
        error: (err as Error).message,
        hint: "Vérifiez le secret JUDILIBRE_KEY_ID dans Supabase.",
      }, 500);
    }

    const target = collected.slice(0, maxDecisions);
    await updateJob(db, jobId, { items_total: target.length });

    if (dryRun) {
      await finishJob(db, jobId, "completed", { items_processed: 0 });
      return jsonResponse({ job_id: jobId, dry_run: true, found: target.length });
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
    return jsonResponse({ job_id: jobId, processed, failed, total: target.length });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

function defaultDateStart(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
