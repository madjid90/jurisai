// connector-cnil-full — Délibérations + sanctions CNIL.
// Pas d'auth. Batch resumable. Pagination via offset sur l'API publique CNIL.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 135_000;
const CNIL_LIST = (type: string, page: number) =>
  `https://www.cnil.fr/api/v1.0/articles/recents.json?type=${type}&page=${page}&pagesize=50`;

interface CnilArticle { id?: string | number; uuid?: string; title?: string; url?: string; path?: string; date?: string; date_published?: string; summary?: string; body?: string; type?: string; }
interface BatchItem { id: string; title: string; url: string; type: string; date?: string; }

async function loadIndex(types: string[], maxPerType: number): Promise<BatchItem[]> {
  const out: BatchItem[] = [];
  for (const t of types) {
    let page = 1;
    while (out.filter((o) => o.type === t).length < maxPerType && page < 50) {
      try {
        const r = await fetch(CNIL_LIST(t, page), { headers: { "User-Agent": "JurisAI/1.0", Accept: "application/json" } });
        if (!r.ok) break;
        const data = await r.json() as CnilArticle[] | { items?: CnilArticle[] };
        const arr = Array.isArray(data) ? data : (data.items ?? []);
        if (!arr.length) break;
        for (const a of arr) {
          const id = String(a.uuid ?? a.id ?? a.path ?? a.url ?? "");
          if (!id || !a.title) continue;
          const url = a.url ?? (a.path ? `https://www.cnil.fr${a.path}` : "");
          out.push({ id, title: a.title, url, type: t, date: a.date_published ?? a.date });
        }
        page++;
      } catch { break; }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({})) as { dry_run?: boolean; types?: string[]; max_per_type?: number; resume_batch_id?: string };
    const db = getAdminClient();
    const apiKey = getLovableApiKey();

    let batchId: string;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      const types = body.types ?? ["deliberation", "sanction"];
      const items = await loadIndex(types, body.max_per_type ?? 500);
      if (body.dry_run) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "cnil-full", "cnil_articles", items, { types });
    }

    // @ts-ignore EdgeRuntime injecté par Supabase

    EdgeRuntime.waitUntil((async () => {

      try {

          const start = Date.now();
          let ingested = 0, skipped = 0, failed = 0;

          while (Date.now() - start < TIME_BUDGET_MS) {
            const items = await getNextItems<BatchItem>(db, batchId, 10);
            if (!items.length) break;
            const ok: BatchItem[] = [], fl: BatchItem[] = [];
            let ing = 0, sk = 0;

            for (const it of items) {
              if (Date.now() - start > TIME_BUDGET_MS) break;
              try {
                // Fetch HTML for full body — clean it.
                const r = await fetch(it.url, { headers: { "User-Agent": "JurisAI/1.0" } });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const html = await r.text();
                // Extract main article body (heuristic)
                const m = html.match(/<article[\s\S]*?<\/article>/i);
                let text = (m ? m[0] : html)
                  .replace(/<script[\s\S]*?<\/script>/gi, " ")
                  .replace(/<style[\s\S]*?<\/style>/gi, " ")
                  .replace(/<[^>]+>/g, " ")
                  .replace(/&nbsp;/g, " ")
                  .replace(/\s+/g, " ")
                  .trim();
                if (text.length < 200) { ok.push(it); continue; }
                if (text.length > 60_000) text = text.slice(0, 60_000);

                const content = `**Source officielle** : CNIL — ${it.type}\n\n# ${it.title}\n\n${text}`;
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "cnil-full", it.id, hash);
                if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

                await ingestSource(db, apiKey, "cnil", {
                  external_id: it.id,
                  source_type: it.type === "sanction" ? "cnil_sanction" : "cnil_deliberation",
                  title: it.title,
                  content,
                  official_url: it.url,
                  legal_date: it.date ? it.date.slice(0, 10) : null,
                  raw_metadata: { cnil_type: it.type, content_hash: hash },
                });
                ing++; ok.push(it);
              } catch (err) {
                fl.push(it);
                console.error(`[cnil-full] ${it.id}:`, (err as Error).message);
              }
            }

            if (ok.length) await markProcessed(db, batchId, ok, ing, sk);
            if (fl.length) await markFailed(db, batchId, fl, "see logs");
            ingested += ing; skipped += sk; failed += fl.length;
          }

          const fin = await finalizeBatch(db, batchId);
          console.log(`[return json({ batch_id: batchId, status: fin.status, processed: fin.processed, total: fin.total, ingested, skipped_unchanged: skipped, failed });`.replace('return json(','').replace(');',''));

      } catch (err) {

        console.error(`[connector-cnil-full] background error:`, (err as Error).message);

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
