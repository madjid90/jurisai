// connector-judilibre-full — Jurisprudence Cour de cassation via PISTE Judilibre.
// Batch resumable. Recherche par chambre + plage de dates, ingestion 1 row/décision.
//
// POST body: { chambers?: string[], date_start?: "YYYY-MM-DD", date_end?: string,
//              query?: string, max_decisions?: number, resume_batch_id?: string, dry_run?: boolean }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { appendBatchItems, finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 135_000;
const JUDILIBRE_BASE = "https://api.piste.gouv.fr/cassation/judilibre/v1.0";
const JUDILIBRE_SANDBOX = "https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0";
const baseUrl = () => Deno.env.get("PISTE_SANDBOX") === "1" ? JUDILIBRE_SANDBOX : JUDILIBRE_BASE;

interface Hit {
  id: string; chamber?: string; formation?: string; decision_date?: string;
  number?: string; solution?: string; summary?: string; text?: string; themes?: string[];
}
interface BatchItem { id: string; chamber?: string; date?: string; number?: string; retries?: number; }

function getKey(): string {
  const k = Deno.env.get("PISTE_API_KEY") ?? Deno.env.get("JUDILIBRE_KEY_ID");
  if (!k) throw new Error("PISTE_API_KEY manquant pour Judilibre.");
  return k;
}

async function searchPaginated(query: string, chambers: string[], dStart: string, dEnd: string, max: number): Promise<Hit[]> {
  const key = getKey();
  const out: Hit[] = [];
  let page = 0;
  const pageSize = 50;
  // max <= 0 => pas de plafond (totalité disponible via pagination API)
  const unlimited = max <= 0;
  while (unlimited || out.length < max) {
    const url = `${baseUrl()}/search?` +
      new URLSearchParams({ query, page: String(page), page_size: String(pageSize), date_start: dStart, date_end: dEnd }).toString() +
      chambers.map((c) => `&chamber=${c}`).join("");
    const res = await fetch(url, { headers: { KeyId: key, apikey: key, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Judilibre /search ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as { results?: Hit[]; result?: Hit[] };
    const hits = data.results ?? data.result ?? [];
    if (!hits.length) break;
    out.push(...hits);
    if (hits.length < pageSize) break;
    page++;
  }
  return unlimited ? out : out.slice(0, max);
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Auto-relance interne (chaînage de ticks) via secret partagé.
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
    let planning: { chambers: string[]; dStart: string; dEnd: string; query: string; max: number } | null = null;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      // Valeurs valides côté Judilibre: pl, mi, civ1, civ2, civ3, comm, soc, cr (chambre criminelle)
      const chambers: string[] = Array.isArray(body.chambers) && body.chambers.length ? body.chambers : ["pl", "mi", "soc", "comm", "civ1", "civ2", "civ3", "cr"];
      const dEnd: string = body.date_end ?? new Date().toISOString().slice(0, 10);
      const dStart: string = body.date_start ?? (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 5); return d.toISOString().slice(0, 10); })();
      const query: string = typeof body.query === "string" && body.query.trim() ? body.query.trim() : "*";
      // max_decisions = 0 (ou absent) => totalité disponible (pagination jusqu'à épuisement)
      const max = body.max_decisions === undefined ? 0 : Number(body.max_decisions);

      if (dryRun) {
        // Dry-run: échantillon rapide, page unique première chambre
        const sample = await searchPaginated(query, chambers.slice(0, 1), dStart, dEnd, 50);
        return json({ dry_run: true, found_sample: sample.length, sample: sample.slice(0, 5).map((h) => ({ id: h.id, chamber: h.chamber, date: h.decision_date })) });
      }
      // Crée un batch vide immédiatement, planning en arrière-plan
      batchId = await startBatch(db, "judilibre-full", "decisions", [], { chambers, query, dStart, dEnd, planning: "in_progress" });
      planning = { chambers, dStart, dEnd, query, max };
    }

    // @ts-ignore EdgeRuntime injecté par Supabase

    EdgeRuntime.waitUntil((async () => {

      try {

          const start = Date.now();
          let ingested = 0, skipped = 0, failed = 0;
          const key = getKey();
          let planningDone = planning === null;

          // Planification asynchrone: paginate par chambre, append items au fur et à mesure
          const planTask = planning ? (async () => {
            const { chambers, dStart, dEnd, query, max } = planning!;
            const pageSize = 50;
            const unlimited = max <= 0;
            let totalSoFar = 0;
            try {
              for (const ch of chambers) {
                let page = 0;
                while (unlimited || totalSoFar < max) {
                  const url = `${baseUrl()}/search?` +
                    new URLSearchParams({ query, page: String(page), page_size: String(pageSize), date_start: dStart, date_end: dEnd }).toString() +
                    `&chamber=${ch}`;
                  const res = await fetch(url, { headers: { KeyId: key, apikey: key, Accept: "application/json" } });
                  if (!res.ok) { console.error(`[judilibre-full] plan ${ch} p${page} ${res.status}`); break; }
                  const data = await res.json() as { results?: Hit[]; result?: Hit[] };
                  const hits = data.results ?? data.result ?? [];
                  if (!hits.length) break;
                  const slice = unlimited ? hits : hits.slice(0, Math.max(0, max - totalSoFar));
                  const items: BatchItem[] = slice.map((h) => ({ id: h.id, chamber: h.chamber, date: h.decision_date, number: h.number }));
                  if (items.length) {
                    // Append en SQL: total_items = total_items || items, total_count++
                    const { error } = await db.rpc("append_batch_items", { p_batch_id: batchId, p_items: items });
                    if (error) console.error(`[judilibre-full] append err: ${error.message}`);
                    totalSoFar += items.length;
                  }
                  if (hits.length < pageSize) break;
                  page++;
                  if (!unlimited && totalSoFar >= max) break;
                }
                if (!unlimited && totalSoFar >= max) break;
              }
            } finally {
              planningDone = true;
              console.log(`[judilibre-full] planning fini: ${totalSoFar} items`);
            }
          })() : Promise.resolve();

          while (Date.now() - start < TIME_BUDGET_MS) {
            const items = await getNextItems<BatchItem>(db, batchId, 15);
            if (!items.length) {
              if (planningDone) break;
              await heartbeat(db, batchId);
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            }
            await heartbeat(db, batchId);
            const ok: BatchItem[] = [], fl: BatchItem[] = [];
            let ing = 0, sk = 0;

            for (const it of items) {
              if (Date.now() - start > TIME_BUDGET_MS) break;
              try {
                const res = await fetch(`${baseUrl()}/decision?id=${encodeURIComponent(it.id)}`, { headers: { KeyId: key, apikey: key, Accept: "application/json" } });
                if (!res.ok) throw new Error(`/decision ${res.status}`);
                const d = await res.json() as Hit;
                const text = (d.text ?? d.summary ?? "").trim();
                if (!text || text.length < 100) { ok.push(it); continue; }

                const content = `**Cour de cassation** · ${d.chamber ?? ""} · ${d.decision_date ?? ""}\n\n# Décision ${d.number ?? d.id}\n\n${text}`;
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "judilibre", d.id, hash);
                if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

                await ingestSource(db, apiKey, "judilibre", {
                  external_id: d.id,
                  source_type: "jurisprudence",
                  title: `Cass. ${d.chamber ?? ""} ${d.decision_date ?? ""} — ${d.number ?? d.id}`.trim(),
                  content,
                  reference_code: d.number ?? null,
                  official_url: `https://www.courdecassation.fr/decision/${d.id}`,
                  legal_date: d.decision_date ?? null,
                  raw_metadata: { chamber: d.chamber, formation: d.formation, solution: d.solution, themes: d.themes, content_hash: hash },
                });
                ing++; ok.push(it);
              } catch (err) {
                const message = (err as Error).message;
                const retries = (it.retries ?? 0) + 1;
                if (retries < 3) {
                  await appendBatchItems(db, batchId, [{ ...it, retries }]);
                  ok.push(it);
                  console.warn(`[judilibre-full] ${it.id}: transient error (${message}), retry ${retries}/2`);
                  continue;
                }
                fl.push(it);
                console.error(`[judilibre-full] ${it.id}:`, message);
              }
              await new Promise((r) => setTimeout(r, 100));
            }

            if (ok.length) await markProcessed(db, batchId, ok, ing, sk);
            if (fl.length) await markFailed(db, batchId, fl, "see logs");
            ingested += ing; skipped += sk; failed += fl.length;
          }

          // Si planning pas terminé, force pause pour permettre auto-resume
          if (!planningDone) {
            await db.from("ingestion_batch_state").update({ status: "paused", last_tick_at: new Date().toISOString() }).eq("id", batchId);
          }
          const fin = await finalizeBatch(db, batchId);
          console.log(`[connector-judilibre-full] tick done batch=${batchId} status=${fin.status} processed=${fin.processed}/${fin.total} ingested=${ingested} skipped=${skipped} failed=${failed}`);

          // Auto-resume si pas terminé (utilise CRON_SECRET pour bypasser super_admin)
          if (fin.status === "paused" || !planningDone) {
            const cronSecret = Deno.env.get("CRON_SECRET");
            const supaUrl = Deno.env.get("SUPABASE_URL");
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (cronSecret && supaUrl && serviceKey) {
              try {
                await fetch(`${supaUrl}/functions/v1/connector-judilibre-full`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-internal-cron": cronSecret,
                    "Authorization": `Bearer ${serviceKey}`,
                  },
                  body: JSON.stringify({ resume_batch_id: batchId }),
                });
                console.log(`[judilibre-full] auto-resume scheduled for batch ${batchId}`);
              } catch (e) {
                console.warn(`[judilibre-full] auto-resume failed:`, (e as Error).message);
              }
            } else {
              console.warn(`[judilibre-full] CRON_SECRET manquant — auto-resume désactivé`);
            }
          }

      } catch (err) {

        try {
          await db.from("ingestion_batch_state")
            .update({ status: "paused", last_tick_at: new Date().toISOString() })
            .eq("id", batchId);
        } catch (_pauseErr) {
        }
        console.error(`[connector-judilibre-full] background error:`, (err as Error).message);

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
