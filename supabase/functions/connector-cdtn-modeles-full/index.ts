// connector-cdtn-modeles-full — Modèles de courriers RH depuis SocialGouv/cdtn-admin.
// Pas d'auth. Batch resumable. Index via items.json filtré sur source=modeles-courriers-types.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 135_000;
const CDTN_API = "https://www.code.travail.gouv.fr/api/items.json";

interface BatchItem { slug: string; title: string; url?: string; }

async function loadIndex(): Promise<BatchItem[]> {
  const r = await fetch(CDTN_API);
  if (!r.ok) throw new Error(`CDTN items.json ${r.status}`);
  const data = await r.json() as Array<{ source?: string; slug?: string; title?: string; url?: string }>;
  return data
    .filter((d) => d.source === "modeles-courriers-types" || d.source === "modeles_de_courriers")
    .filter((d) => d.slug && d.title)
    .map((d) => ({ slug: d.slug!, title: d.title!, url: d.url }));
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({})) as { dry_run?: boolean; resume_batch_id?: string };
    const db = getAdminClient();
    const apiKey = getLovableApiKey();

    let batchId: string;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      const items = await loadIndex();
      if (body.dry_run) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "cdtn-modeles-full", "modeles", items, {});
    }

    // @ts-ignore EdgeRuntime injecté par Supabase

    EdgeRuntime.waitUntil((async () => {

      try {

          const start = Date.now();
          let ingested = 0, skipped = 0, failed = 0;

          while (Date.now() - start < TIME_BUDGET_MS) {
            const items = await getNextItems<BatchItem>(db, batchId, 15);
            if (!items.length) break;
            const ok: BatchItem[] = [], fl: BatchItem[] = [];
            let ing = 0, sk = 0;

            for (const it of items) {
              if (Date.now() - start > TIME_BUDGET_MS) break;
              try {
                const r = await fetch(`https://www.code.travail.gouv.fr/api/items/${it.slug}.json`);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const f = await r.json() as { title?: string; description?: string; html?: string; text?: string; intro?: string; questions?: Array<{ name?: string; html?: string }> };
                let body = f.intro ?? f.text ?? f.description ?? "";
                if (Array.isArray(f.questions)) {
                  body += "\n\n" + f.questions.map((q) => `## ${q.name ?? ""}\n${(q.html ?? "").replace(/<[^>]+>/g, " ")}`).join("\n\n");
                }
                if (!body && f.html) body = f.html.replace(/<[^>]+>/g, " ");
                body = body.replace(/\s+/g, " ").trim();
                if (body.length < 80) { ok.push(it); continue; }

                const content = `**Source officielle** : Ministère du Travail (CDTN)\n\n# ${it.title}\n\n${body}`;
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "cdtn-modeles-full", it.slug, hash);
                if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

                await ingestSource(db, apiKey, "cdtn-modeles", {
                  external_id: it.slug,
                  source_type: "modele_courrier",
                  title: it.title,
                  content,
                  official_url: it.url ?? `https://www.code.travail.gouv.fr/${it.slug}`,
                  raw_metadata: { slug: it.slug, content_hash: hash },
                });
                ing++; ok.push(it);
              } catch (err) {
                fl.push(it);
                console.error(`[cdtn-modeles-full] ${it.slug}:`, (err as Error).message);
              }
            }

            if (ok.length) await markProcessed(db, batchId, ok, ing, sk);
            if (fl.length) await markFailed(db, batchId, fl, "see logs");
            ingested += ing; skipped += sk; failed += fl.length;
          }

          const fin = await finalizeBatch(db, batchId);
          console.log(`[return json({ batch_id: batchId, status: fin.status, processed: fin.processed, total: fin.total, ingested, skipped_unchanged: skipped, failed });`.replace('return json(','').replace(');',''));

      } catch (err) {

        console.error(`[connector-cdtn-modeles-full] background error:`, (err as Error).message);

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
