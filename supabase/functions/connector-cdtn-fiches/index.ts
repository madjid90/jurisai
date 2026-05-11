// connector-cdtn-fiches — Fiches Service-Public + fiches-MT depuis SocialGouv/cdtn-admin (GitHub).
// Pas d'auth. Batch resumable. Walks la liste de fiches puis fetch chaque markdown.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 60_000;
// Fiches Service-Public packagées dans cdtn-admin (JSON bundle)
const CDTN_FICHES_INDEX = "https://raw.githubusercontent.com/SocialGouv/cdtn-admin/master/targets/frontend/src/server/legi-data/fiches-service-public/index.json";
// Fallback list (curated) si l'index n'existe pas
const CDTN_API = "https://www.code.travail.gouv.fr/api/items.json";

interface FicheEntry {
  slug?: string;
  title?: string;
  url?: string;
  source?: string;
  raw?: string;
}
interface BatchItem { slug: string; title: string; url?: string; source?: string; }

async function loadIndex(): Promise<BatchItem[]> {
  // Stratégie 1 : items.json du site code.travail.gouv.fr (fiable)
  const res = await fetch(CDTN_API);
  if (!res.ok) throw new Error(`CDTN items.json ${res.status}`);
  const data = await res.json() as Array<{ source?: string; slug?: string; title?: string; url?: string }>;
  return data
    .filter((d) => d.source === "fiches-service-public" || d.source === "fiches-ministere-travail")
    .filter((d) => d.slug && d.title)
    .map((d) => ({ slug: d.slug!, title: d.title!, url: d.url, source: d.source }));
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Auto-resume interne (chaînage de ticks) : secret partagé au lieu de JWT.
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

    let batchId: string;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      const items = await loadIndex();
      if (dryRun) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "cdtn-fiches", "fiches", items, {});
    }

    // @ts-ignore EdgeRuntime injecté par Supabase

    EdgeRuntime.waitUntil((async () => {

      try {

          const start = Date.now();
          let ingested = 0, skipped = 0, failed = 0;

          while (Date.now() - start < TIME_BUDGET_MS) {
            const items = await getNextItems<BatchItem>(db, batchId, 1);
            if (!items.length) break;
            const ok: BatchItem[] = [], fl: BatchItem[] = [];
            let ing = 0, sk = 0;

            for (const it of items) {
              if (Date.now() - start > TIME_BUDGET_MS) break;
              try {
                const ficheUrl = `https://www.code.travail.gouv.fr/api/items/${it.slug}.json`;
                const r = await fetch(ficheUrl);
                if (!r.ok) throw new Error(`fiche ${it.slug} HTTP ${r.status}`);
                const f = await r.json() as { title?: string; description?: string; html?: string; text?: string; raw?: string; sections?: Array<{ title?: string; html?: string; text?: string }> };

                let body = f.text ?? f.raw ?? f.description ?? "";
                if (!body && Array.isArray(f.sections)) {
                  body = f.sections.map((s) => `## ${s.title ?? ""}\n${(s.text ?? s.html ?? "").replace(/<[^>]+>/g, " ")}`).join("\n\n");
                }
                if (!body && f.html) body = f.html.replace(/<[^>]+>/g, " ");
                body = body.replace(/\s+/g, " ").trim();

                if (!body || body.length < 100) { ok.push(it); continue; }

                const title = f.title ?? it.title;
                const content = `**Source officielle** : ${it.source === "fiches-service-public" ? "Service-Public.fr" : "Ministère du Travail"}\n\n# ${title}\n\n${body}`;
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "cdtn-fiches", it.slug, hash);
                if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

                await ingestSource(db, apiKey, "cdtn-fiches", {
                  external_id: it.slug,
                  source_type: it.source === "fiches-service-public" ? "fiche_service_public" : "fiche_ministere_travail",
                  title,
                  content,
                  official_url: it.url ?? `https://www.code.travail.gouv.fr/${it.slug}`,
                  raw_metadata: { slug: it.slug, source: it.source, content_hash: hash },
                });
                ing++; ok.push(it);
              } catch (err) {
                fl.push(it);
                console.error(`[cdtn-fiches] ${it.slug}:`, (err as Error).message);
              }
            }

            if (ok.length) await markProcessed(db, batchId, ok, ing, sk);
            if (fl.length) await markFailed(db, batchId, fl, "see logs");
            ingested += ing; skipped += sk; failed += fl.length;
          }

          const fin = await finalizeBatch(db, batchId);
          console.log(`[connector-cdtn-fiches] batch ${batchId} fini: status=${fin.status} processed=${fin.processed}/${fin.total} ingested=${ingested} skipped=${skipped} failed=${failed}`);

          if (fin.status === "paused") {
            const cs = Deno.env.get("CRON_SECRET");
            const su = Deno.env.get("SUPABASE_URL");
            if (cs && su) {
              try {
                await fetch(`${su}/functions/v1/connector-cdtn-fiches-full`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-internal-cron": cs,
                    "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
                  },
                  body: JSON.stringify({ resume_batch_id: batchId }),
                });
                console.log(`[connector-cdtn-fiches-full] auto-resume scheduled for batch ${batchId}`);
              } catch (e) {
                console.warn(`[connector-cdtn-fiches-full] auto-resume failed:`, (e as Error).message);
              }
            }
          }

      } catch (err) {

        console.error(`[connector-cdtn-fiches] background error:`, (err as Error).message);

      }

    })());

    return json({

      status: "started",

      message: "Ingestion lancée en arrière-plan. Le batch apparaîtra dans Jobs récents sous ~10s.",

      batch_id: batchId,

    }, 202);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
