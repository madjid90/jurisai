// ============================================================================
// connector-kali-full — Conventions Collectives (KALI) version COMPLÈTE.
// ============================================================================
// Replaces legacy `connector-kali`. Differences:
//  - Walks each convention's unist tree (kali-data) -> 1 legal_source per article
//  - Stores section_path (livre > titre > chapitre > section) for hierarchy
//  - SHA-256 content_hash to skip unchanged articles (~95% LLM savings on reruns)
//  - Batch + checkpoint via ingestion_batch_state -> resumable across timeouts
//
// POST body:
//   { mode?: "top" | "all" | "idcc", idcc?: string[], batch_size?: number,
//     resume_batch_id?: string, dry_run?: boolean }
// Default: mode = "top".
//
// Per-tick budget: TIME_BUDGET_MS (135s). After that the batch is paused,
// caller can re-invoke with { resume_batch_id } to continue.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeadersFor,
  getAdminClient,
  getLovableApiKey,
  ingestSource,
} from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import {
  finalizeBatch,
  getNextItems,
  markFailed,
  markProcessed,
  startBatch,
} from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";
import {
  buildArticleContent,
  extractAllArticles,
  type UnistNode,
} from "../_shared/unist-extract.ts";

const TIME_BUDGET_MS = 135_000;
// CDN unpkg : pas de rate-limit (vs raw.githubusercontent.com)
const KALI_INDEX_URL = "https://unpkg.com/@socialgouv/kali-data/data/index.json";
const KALI_RAW_BASE = "https://unpkg.com/@socialgouv/kali-data/data";

// Top IDCC to seed first (employee coverage rank).
const TOP_IDCC = [
  "1486", "1979", "1090", "3248", "0573", "2216", "1387", "1597",
  "1505", "2120", "3043", "2511", "1672", "2098", "1517", "1606",
  "1996", "1311", "0843", "2002", "1413", "0086", "1483", "2378",
  "1747", "1043", "1351", "0454", "1396", "0653", "1812", "1170",
  "0700", "1404", "0044", "2147", "0292", "0184", "1518",
  "2941", "2964", "2335", "1631", "0247", "0240", "0635",
  "1077", "1316",
];

interface KaliIndexEntry {
  id: string;
  num: string;
  title: string;
  shortTitle?: string;
  url?: string;
  effectif?: number;
  active?: boolean;
}

interface BatchItem {
  kali_id: string;
  idcc: string;
  title: string;
  url?: string;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const db = getAdminClient();
    const apiKey = getLovableApiKey();

    // ── 1. Resume or start a batch ───────────────────────────────────────────
    let batchId: string;

    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      const mode: "top" | "all" | "idcc" = body.mode ?? "top";
      const requested: string[] = Array.isArray(body.idcc) ? body.idcc : [];

      const idxRes = await fetch(KALI_INDEX_URL);
      if (!idxRes.ok) return json({ error: `KALI index ${idxRes.status}` }, 502);
      const index: KaliIndexEntry[] = await idxRes.json();

      let target: KaliIndexEntry[];
      if (mode === "all") {
        target = index.filter((e) => e.active !== false);
      } else if (mode === "idcc" && requested.length) {
        const set = new Set(requested);
        target = index.filter((e) => set.has(e.num));
      } else {
        const set = new Set(TOP_IDCC);
        target = index.filter((e) => set.has(e.num) && e.active !== false);
      }

      const items: BatchItem[] = target.map((e) => ({
        kali_id: e.id,
        idcc: e.num,
        title: e.title,
        url: e.url,
      }));

      if (dryRun) {
        return json({
          dry_run: true,
          mode,
          conventions_total: items.length,
          sample: items.slice(0, 5),
        });
      }

      batchId = await startBatch(db, "kali-full", "conventions", items, { mode });

      // Upsert convention metadata (idempotent, cheap)
      for (const e of target) {
        await db.from("conventions_collectives").upsert({
          idcc: e.num,
          title: e.title,
          short_title: e.shortTitle ?? null,
          is_active: e.active !== false,
          effectif: e.effectif ?? null,
          source_url: e.url ?? `https://www.legifrance.gouv.fr/conv_coll/id/${e.id}`,
          raw_metadata: e as unknown as Record<string, unknown>,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: "idcc" });
      }
    }

    // ── 2. Process batch items within time budget ────────────────────────────
    const start = Date.now();
    let totalIngested = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    const BATCH_PER_TICK = 5; // process up to 5 conventions per fetch

    while (Date.now() - start < TIME_BUDGET_MS) {
      const items = await getNextItems<BatchItem>(db, batchId, BATCH_PER_TICK);
      if (items.length === 0) break;

      const processed: BatchItem[] = [];
      const failed: BatchItem[] = [];
      let perTickIngested = 0;
      let perTickSkipped = 0;

      for (const item of items) {
        if (Date.now() - start > TIME_BUDGET_MS) break;
        try {
          const detRes = await fetch(`${KALI_RAW_BASE}/${item.kali_id}.json`);
          if (!detRes.ok) throw new Error(`detail HTTP ${detRes.status}`);
          const detail = await detRes.json() as UnistNode;

          const articles = extractAllArticles(detail, { keepAbrogated: false });

          for (const art of articles) {
            const content = buildArticleContent(art, item.title);
            const hash = await sha256(content);
            const externalId = `kali:${item.idcc}:${art.externalId}`;
            const decision = await shouldIngest(db, "kali", externalId, hash);
            if (!decision.shouldIngest) {
              perTickSkipped++;
              continue;
            }

            await ingestSource(db, apiKey, "kali", {
              external_id: externalId,
              source_type: "convention_article",
              title: `${item.title} (IDCC ${item.idcc}) — ${art.num ? `Article ${art.num}` : (art.title ?? "Disposition")}`,
              content,
              reference_code: art.num ? `IDCC ${item.idcc} Art. ${art.num}` : `IDCC ${item.idcc}`,
              official_url: item.url ?? null,
              legal_date: art.dateDebut,
              idcc: item.idcc,
              raw_metadata: {
                kali_id: item.kali_id,
                section_path: art.sectionPath,
                etat: art.etat,
                content_hash: hash,
                cid: art.cid,
              },
            });
            perTickIngested++;
          }

          processed.push(item);
        } catch (err) {
          failed.push(item);
          console.error(`[kali-full] item ${item.kali_id} (IDCC ${item.idcc}) failed:`, (err as Error).message);
        }
      }

      if (processed.length) {
        await markProcessed(db, batchId, processed, perTickIngested, perTickSkipped);
      }
      if (failed.length) {
        await markFailed(db, batchId, failed, "see ingestion_errors");
      }

      totalIngested += perTickIngested;
      totalSkipped += perTickSkipped;
      totalFailed += failed.length;
    }

    // ── 3. Finalize (auto-detects paused vs completed) ───────────────────────
    const finalState = await finalizeBatch(db, batchId);

    return json({
      batch_id: batchId,
      status: finalState.status,
      processed: finalState.processed,
      total: finalState.total,
      articles_ingested: totalIngested,
      articles_skipped_unchanged: totalSkipped,
      tick_failed: totalFailed,
      resume_hint: finalState.status === "paused"
        ? `Re-call with { "resume_batch_id": "${batchId}" } or rely on /api/public/hooks/orchestrator-tick`
        : null,
    });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
