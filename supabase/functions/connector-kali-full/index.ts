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

// Budget conservateur : Supabase coupe sur "CPU Time exceeded" bien avant
// la limite wall-clock quand on parse de gros JSON KALI. 60s laisse de la
// marge pour finaliser proprement le batch et auto-relancer le tick suivant.
const TIME_BUDGET_MS = 60_000;
// Sources de données KALI (avec fallback automatique).
// unpkg renvoyait 500 (package > 150 MB) ; on bascule sur raw.githubusercontent
// en primaire (stable, pas de quota CDN), avec esm.sh en secours.
const KALI_INDEX_URLS = [
  "https://raw.githubusercontent.com/SocialGouv/kali-data/master/data/index.json",
  "https://esm.sh/@socialgouv/kali-data/data/index.json",
];
const KALI_RAW_BASES = [
  "https://raw.githubusercontent.com/SocialGouv/kali-data/master/data",
  "https://esm.sh/@socialgouv/kali-data/data",
];

async function fetchWithFallback(paths: string[]): Promise<Response> {
  let lastErr: unknown = null;
  for (const url of paths) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (r.ok) return r;
      lastErr = new Error(`${url} -> HTTP ${r.status}`);
      console.warn(`[kali-full] source failed ${url} HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
      console.warn(`[kali-full] source error ${url}`, (e as Error).message);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all sources failed");
}

async function fetchKaliIndex(): Promise<Response> {
  return fetchWithFallback(KALI_INDEX_URLS);
}

async function fetchKaliDetail(kaliId: string): Promise<Response> {
  return fetchWithFallback(KALI_RAW_BASES.map((b) => `${b}/${kaliId}.json`));
}

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
  idcc?: string;   // optionnel : rempli depuis le détail si absent (mode "all")
  title?: string;
  url?: string;
}

// Mode "all" : l'index officiel kali-data ne liste que ~49 conventions, mais le
// repo en contient ~393 (fichiers KALICONT*.json). On énumère via GitHub API
// pour avoir la liste complète, et on récupère IDCC/titre depuis le détail.
async function listAllKaliFromGitHub(): Promise<string[]> {
  const r = await fetch(
    "https://api.github.com/repos/SocialGouv/kali-data/contents/data?ref=master&per_page=1000",
    { headers: { "Accept": "application/vnd.github+json", "User-Agent": "jurisai-ingest" } },
  );
  if (!r.ok) throw new Error(`GitHub Contents HTTP ${r.status}`);
  const files = await r.json() as Array<{ name: string }>;
  return files
    .filter((f) => f.name.startsWith("KALICONT") && f.name.endsWith(".json"))
    .map((f) => f.name.replace(/\.json$/, ""));
}

async function runIngestion(
  db: ReturnType<typeof getAdminClient>,
  apiKey: string,
  body: { resume_batch_id?: string; mode?: "top" | "all" | "idcc"; idcc?: string[] },
): Promise<void> {
  let batchId: string;

  if (body.resume_batch_id) {
    batchId = String(body.resume_batch_id);
  } else {
    const mode: "top" | "all" | "idcc" = body.mode ?? "top";
    const requested: string[] = Array.isArray(body.idcc) ? body.idcc : [];

    let items: BatchItem[];

    if (mode === "all") {
      const ids = await listAllKaliFromGitHub();
      items = ids.map((id) => ({ kali_id: id }));
    } else {
      // top + idcc utilisent l'index (les 49 conventions sont les principales)
      const idxRes = await fetchKaliIndex();
      if (!idxRes.ok) throw new Error(`KALI index HTTP ${idxRes.status}`);
      const index: KaliIndexEntry[] = await idxRes.json();
      let target: KaliIndexEntry[];
      if (mode === "idcc" && requested.length) {
        const set = new Set(requested);
        target = index.filter((e) => set.has(e.num));
      } else {
        const set = new Set(TOP_IDCC);
        target = index.filter((e) => set.has(e.num) && e.active !== false);
      }
      items = target.map((e) => ({ kali_id: e.id, idcc: e.num, title: e.title, url: e.url }));

      // Pré-upsert dans conventions_collectives (on a déjà les métadonnées)
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

    batchId = await startBatch(db, "kali-full", "conventions", items, { mode });
    console.log(`[kali-full] batch ${batchId} planned: ${items.length} conventions (mode=${mode})`);
  }

  const start = Date.now();
  let totalIngested = 0, totalSkipped = 0, totalFailed = 0;

  // Une convention par itération + commit immédiat (markProcessed) → progression
  // visible en temps réel et batch reprenable même si le runtime nous coupe.
  while (Date.now() - start < TIME_BUDGET_MS) {
    const items = await getNextItems<BatchItem>(db, batchId, 1);
    if (items.length === 0) break;
    const item = items[0];

    let perItemIngested = 0;
    let perItemSkipped = 0;
    let failed = false;

    try {
      const detRes = await fetchKaliDetail(item.kali_id);
      if (!detRes.ok) throw new Error(`detail HTTP ${detRes.status}`);
      const detail = await detRes.json() as UnistNode & {
        data?: { id?: string; num?: string | number; title?: string; shortTitle?: string; url?: string; active?: boolean; effectif?: number };
      };

      // Mode "all" : IDCC/titre absents au planning, on les déduit du détail
      // (data.num = IDCC, data.title = libellé) puis on upsert la convention.
      const meta = detail.data ?? {};
      const idcc = item.idcc ?? (meta.num != null ? String(meta.num).padStart(4, "0") : item.kali_id);
      const title = item.title ?? meta.title ?? `Convention ${idcc}`;
      const url = item.url ?? meta.url ?? `https://www.legifrance.gouv.fr/conv_coll/id/${item.kali_id}`;

      if (!item.idcc && idcc) {
        await db.from("conventions_collectives").upsert({
          idcc,
          title,
          short_title: meta.shortTitle ?? null,
          is_active: meta.active !== false,
          effectif: meta.effectif ?? null,
          source_url: url,
          raw_metadata: { kali_id: item.kali_id, ...meta },
          last_synced_at: new Date().toISOString(),
        }, { onConflict: "idcc" });
      }

      const articles = extractAllArticles(detail, { keepAbrogated: false });

      for (const art of articles) {
        const content = buildArticleContent(art, title);
        const hash = await sha256(content);
        const externalId = `kali:${idcc}:${art.externalId}`;
        const decision = await shouldIngest(db, "kali", externalId, hash);
        if (!decision.shouldIngest) { perItemSkipped++; continue; }

        await ingestSource(db, apiKey, "kali", {
          external_id: externalId,
          source_type: "convention_article",
          title: `${title} (IDCC ${idcc}) — ${art.num ? `Article ${art.num}` : (art.title ?? "Disposition")}`,
          content,
          reference_code: art.num ? `IDCC ${idcc} Art. ${art.num}` : `IDCC ${idcc}`,
          official_url: url,
          legal_date: art.dateDebut,
          idcc,
          raw_metadata: { kali_id: item.kali_id, section_path: art.sectionPath, etat: art.etat, content_hash: hash, cid: art.cid },
        });
        perItemIngested++;
      }
    } catch (err) {
      failed = true;
      console.error(`[kali-full] item ${item.kali_id} (IDCC ${item.idcc ?? "?"}) failed:`, (err as Error).message);
    }

    // Commit ATOMIQUE par convention : si le runtime nous coupe au prochain tour,
    // on ne perd pas la progression et on n'aura pas non plus de batch "fantôme".
    if (failed) {
      await markFailed(db, batchId, [item], "see ingestion_errors");
      totalFailed++;
    } else {
      await markProcessed(db, batchId, [item], perItemIngested, perItemSkipped);
      totalIngested += perItemIngested;
      totalSkipped += perItemSkipped;
    }
  }

  const finalState = await finalizeBatch(db, batchId);
  console.log(`[kali-full] tick done batch=${batchId} status=${finalState.status} ingested=${totalIngested} skipped=${totalSkipped} failed=${totalFailed} processed=${finalState.processed}/${finalState.total}`);

  // Auto-relance : si le batch est seulement en pause (CPU/temps épuisé mais
  // items restants), on chaîne un nouveau tick via fetch interne authentifié
  // par CRON_SECRET pour ne pas dépendre d'un re-clic utilisateur.
  if (finalState.status === "paused") {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const supaUrl = Deno.env.get("SUPABASE_URL");
    if (cronSecret && supaUrl) {
      try {
        await fetch(`${supaUrl}/functions/v1/connector-kali-full`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-cron": cronSecret,
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
          },
          body: JSON.stringify({ resume_batch_id: batchId }),
        });
        console.log(`[kali-full] auto-resume scheduled for batch ${batchId}`);
      } catch (e) {
        console.warn(`[kali-full] auto-resume failed:`, (e as Error).message);
      }
    }
  }
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
    // Auto-relance interne (chaînage de ticks) : on accepte un secret partagé
    // au lieu d'un JWT super_admin pour ne pas dépendre d'un re-clic UI.
    const internalToken = req.headers.get("x-internal-cron");
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isInternal = !!internalToken && !!cronSecret && internalToken === cronSecret;
    if (!isInternal) {
      await requireSuperAdmin(req);
    }
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const db = getAdminClient();
    const apiKey = getLovableApiKey();

    if (dryRun) {
      const mode: "top" | "all" | "idcc" = body.mode ?? "top";
      const requested: string[] = Array.isArray(body.idcc) ? body.idcc : [];
      const idxRes = await fetchKaliIndex();
      if (!idxRes.ok) return json({ error: `KALI index ${idxRes.status}` }, 502);
      const index: KaliIndexEntry[] = await idxRes.json();
      let target: KaliIndexEntry[];
      if (mode === "all") target = index.filter((e) => e.active !== false);
      else if (mode === "idcc" && requested.length) {
        const set = new Set(requested);
        target = index.filter((e) => set.has(e.num));
      } else {
        const set = new Set(TOP_IDCC);
        target = index.filter((e) => set.has(e.num) && e.active !== false);
      }
      return json({
        dry_run: true, mode, conventions_total: target.length,
        sample: target.slice(0, 5).map((e) => ({ idcc: e.num, title: e.title })),
      });
    }

    // @ts-ignore EdgeRuntime injecté par Supabase
    EdgeRuntime.waitUntil(
      runIngestion(db, apiKey, body).catch((err) => {
        console.error("[kali-full] background error:", (err as Error).message);
      }),
    );
    return json({
      status: "started",
      message: "Ingestion KALI lancée en arrière-plan. Le batch apparaîtra dans Jobs récents sous ~10s.",
      resume_batch_id: body.resume_batch_id ?? null,
    }, 202);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
