// connector-dole-full — Dossiers législatifs Légifrance via PISTE OAuth.
// Batch resumable. Veille proactive sur les lois en préparation.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";
import { legifranceFetch } from "../_shared/piste.ts";

const TIME_BUDGET_MS = 60_000;
interface BatchItem { id: string; title: string; nature?: string; date?: string; }

async function searchDole(dateStart: string, pageSize: number, page: number) {
  const payload = {
    fond: "DOLE",
    recherche: {
      filtres: [
        { facette: "DATE_SIGNATURE", dates: { start: dateStart, end: new Date().toISOString().slice(0, 10) } },
      ],
      pageSize,
      pageNumber: page,
      sort: "PERTINENCE",
      typePagination: "DEFAUT",
      operateur: "ET",
    },
  };
  return await legifranceFetch<{ results?: Array<{ titles?: Array<{ id: string; title: string }>; nature?: string; date?: string }>; totalResultNumber?: number }>("/search", payload);
}

async function loadIndex(months: number, max: number): Promise<BatchItem[]> {
  const since = new Date(); since.setMonth(since.getMonth() - months);
  const dateStart = since.toISOString().slice(0, 10);
  const out: BatchItem[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 20 && out.length < max; page++) {
    const res = await searchDole(dateStart, 50, page);
    const arr = res.results ?? [];
    if (!arr.length) break;
    for (const r of arr) {
      const t = r.titles?.[0];
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ id: t.id, title: t.title, nature: r.nature, date: r.date });
      if (out.length >= max) break;
    }
  }
  return out;
}

async function fetchDossier(id: string) {
  try {
    return await legifranceFetch<{ titre?: string; resume?: string; exposeMotifs?: string; evenements?: Array<{ date?: string; titre?: string; description?: string }> }>("/consult/jorf", { textCid: id });
  } catch {
    return null;
  }
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
    const body = await req.json().catch(() => ({})) as { dry_run?: boolean; months?: number; max_dossiers?: number; resume_batch_id?: string };
    const db = getAdminClient();
    const apiKey = getLovableApiKey();
    let batchId: string;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      const items = await loadIndex(body.months ?? 24, body.max_dossiers ?? 500);
      if (body.dry_run) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "dole-full", "dossiers", items, { months: body.months ?? 24 });
    }

    // @ts-ignore EdgeRuntime injecté par Supabase

    EdgeRuntime.waitUntil((async () => {

      try {

          const start = Date.now();
          let ingested = 0, skipped = 0, failed = 0;

          while (Date.now() - start < TIME_BUDGET_MS) {
            const items = await getNextItems<BatchItem>(db, batchId, 1);
            if (!items.length) break;
            await heartbeat(db, batchId);
            const ok: BatchItem[] = [], fl: BatchItem[] = [];
            let ing = 0, sk = 0;

            for (const it of items) {
              if (Date.now() - start > TIME_BUDGET_MS) break;
              try {
                const d = await fetchDossier(it.id);
                let body = "";
                if (d) {
                  if (d.resume) body += `## Résumé\n\n${d.resume}\n\n`;
                  if (d.exposeMotifs) body += `## Exposé des motifs\n\n${d.exposeMotifs}\n\n`;
                  if (d.evenements?.length) {
                    body += `## Étapes\n\n` + d.evenements.map((e) => `- ${e.date ?? ""} — ${e.titre ?? ""} ${e.description ?? ""}`).join("\n");
                  }
                }
                body = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                if (body.length < 50) body = `Dossier législatif ${it.title} (${it.nature ?? "loi"}, ${it.date ?? ""})`;

                const content = `**Source officielle** : Légifrance — Dossier législatif\n\n# ${it.title}\n\n${body}`;
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "dole-full", it.id, hash);
                if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

                await ingestSource(db, apiKey, "dole", {
                  external_id: it.id,
                  source_type: "dossier_legislatif",
                  title: it.title.slice(0, 500),
                  content,
                  official_url: `https://www.legifrance.gouv.fr/dossierlegislatif/${it.id}`,
                  legal_date: it.date ? it.date.slice(0, 10) : null,
                  raw_metadata: { nature: it.nature, content_hash: hash },
                });
                ing++; ok.push(it);
              } catch (err) {
                fl.push(it);
                console.error(`[dole-full] ${it.id}:`, (err as Error).message);
              }
            }

            if (ok.length) await markProcessed(db, batchId, ok, ing, sk);
            if (fl.length) await markFailed(db, batchId, fl, "see logs");
            ingested += ing; skipped += sk; failed += fl.length;
          }

          const fin = await finalizeBatch(db, batchId);
          console.log(`[connector-dole-full] batch ${batchId} fini: status=${fin.status} processed=${fin.processed}/${fin.total} ingested=${ingested} skipped=${skipped} failed=${failed}`);

          if (fin.status === "paused") {
            const cs = Deno.env.get("CRON_SECRET");
            const su = Deno.env.get("SUPABASE_URL");
            if (cs && su) {
              try {
                await fetch(`${su}/functions/v1/connector-dole-full`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-internal-cron": cs,
                    "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
                  },
                  body: JSON.stringify({ resume_batch_id: batchId }),
                });
                console.log(`[connector-dole-full] auto-resume scheduled for batch ${batchId}`);
              } catch (e) {
                console.warn(`[connector-dole-full] auto-resume failed:`, (e as Error).message);
              }
            }
          }

      } catch (err) {

        console.error(`[connector-dole-full] background error:`, (err as Error).message);

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
