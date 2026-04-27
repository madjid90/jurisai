// Connector: KALI (Conventions Collectives) via SocialGouv/kali-data on GitHub.
// Strategy: pull the public index and a curated list of top IDCC, store metadata
// in `conventions_collectives`, and ingest the convention text into legal_sources.
//
// POST body: { mode?: "top" | "all" | "idcc", idcc?: string[], limit?: number }
// Default: mode="top" → top 50 IDCC from the spec.

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

// Top IDCC to seed first (from product spec, ranked by employee coverage).
const TOP_IDCC = [
  "1486", "1979", "1090", "3248", "0573", "2216", "1387", "1597",
  "1505", "2120", "3043", "2511", "1672", "2098", "1517", "1606",
  "1996", "1311", "0843", "2002", "1413", "0086", "1483", "2378",
  "1747", "1043", "1351", "0454", "1396", "0653", "1812", "1170",
  "0700", "1404", "0044", "1404", "2147", "0292", "0184", "1518",
  "2941", "2964", "2335", "1631", "0247", "0184", "0240", "0635",
  "1077", "1316",
];

const KALI_INDEX_URL =
  "https://raw.githubusercontent.com/SocialGouv/kali-data/master/data/index.json";
const KALI_RAW_BASE =
  "https://raw.githubusercontent.com/SocialGouv/kali-data/master/data";

interface KaliIndexEntry {
  id: string; // KALICONT...
  num: string; // IDCC, e.g. "1486"
  title: string;
  shortTitle?: string;
  url?: string;
  effectif?: number;
  active?: boolean;
  nature?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const mode: "top" | "all" | "idcc" = body.mode ?? "top";
    const requestedIdcc: string[] = Array.isArray(body.idcc) ? body.idcc : [];
    const limit: number = Math.min(Number(body.limit) || 999, 999);

    const db = getAdminClient();
    const apiKey = getLovableApiKey();
    const jobId = await startJob(db, "kali", { mode, idcc: requestedIdcc, limit });

    // 1. Fetch KALI index
    const indexRes = await fetch(KALI_INDEX_URL);
    if (!indexRes.ok) {
      await finishJob(db, jobId, "failed", {
        items_total: 0,
        items_processed: 0,
      });
      return jsonResponse({ error: `KALI index fetch failed: ${indexRes.status}` }, 502);
    }
    const index: KaliIndexEntry[] = await indexRes.json();

    // 2. Filter
    let target: KaliIndexEntry[];
    if (mode === "all") {
      target = index.filter((e) => e.active !== false).slice(0, limit);
    } else if (mode === "idcc" && requestedIdcc.length > 0) {
      const set = new Set(requestedIdcc);
      target = index.filter((e) => set.has(e.num));
    } else {
      const set = new Set(TOP_IDCC);
      target = index.filter((e) => set.has(e.num) && e.active !== false);
    }

    await updateJob(db, jobId, { items_total: target.length });

    // 3. For each convention: upsert metadata + ingest its text
    let processed = 0;
    let failed = 0;

    for (const entry of target) {
      try {
        // Upsert metadata
        await db.from("conventions_collectives").upsert({
          idcc: entry.num,
          title: entry.title,
          short_title: entry.shortTitle ?? null,
          is_active: entry.active !== false,
          effectif: entry.effectif ?? null,
          source_url: entry.url ?? `https://www.legifrance.gouv.fr/conv_coll/id/${entry.id}`,
          raw_metadata: entry as unknown as Record<string, unknown>,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: "idcc" });

        // Fetch convention details (kali-data ships per-convention JSON)
        const detailUrl = `${KALI_RAW_BASE}/${entry.id}.json`;
        const detRes = await fetch(detailUrl);

        let textContent = entry.title;
        if (detRes.ok) {
          const detail = await detRes.json();
          // Compose plain text from articles array if present
          if (Array.isArray(detail.articles)) {
            textContent = detail.articles
              .slice(0, 200) // cap per CC for MVP
              .map((a: { title?: string; content?: string }) =>
                `${a.title ?? ""}\n\n${a.content ?? ""}`.trim()
              )
              .filter(Boolean)
              .join("\n\n---\n\n");
          } else if (typeof detail.content === "string") {
            textContent = detail.content;
          }
        }

        // Ingest as legal_source for RAG search
        await ingestSource(db, apiKey, "kali", {
          external_id: entry.id,
          source_type: "convention",
          title: `${entry.title} (IDCC ${entry.num})`,
          content: textContent,
          reference_code: `IDCC ${entry.num}`,
          official_url: entry.url ?? null,
          idcc: entry.num,
          raw_metadata: { kali_id: entry.id, brochure: entry.id },
        });

        processed++;
        await updateJob(db, jobId, { items_processed: processed });
      } catch (err) {
        failed++;
        await logError(db, jobId, "kali", entry.id, "ingest_error",
          (err as Error).message, { idcc: entry.num });
      }
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
