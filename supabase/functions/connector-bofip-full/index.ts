// connector-bofip-full — BOFiP (doctrine fiscale).
// Source: data.economie.gouv.fr — dataset officiel MEF "bofip-vigueur" (~9 000 docs).
// Pas de PISTE : l'API Légifrance ne sert pas le fond BOFiP de manière fiable.
//
// POST body: { resume_batch_id?: string, dry_run?: boolean, max_docs?: number }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 60_000;
const API_BASE = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/bofip-vigueur";

interface BatchItem {
  id: string;            // identifiant_juridique (BOI-…)
  titre?: string;
  serie?: string;
  division?: string;
  permalien?: string;
  date?: string;         // debut_de_validite
}

interface BofipRecord {
  identifiant_juridique?: string;
  titre?: string;
  serie?: string;
  division?: string;
  permalien?: string;
  debut_de_validite?: string;
  contenu?: string;
}

async function fetchPage(opts: { select?: string; where?: string; limit: number; offset: number }): Promise<{ total_count: number; results: BofipRecord[] }> {
  const params = new URLSearchParams();
  if (opts.select) params.set("select", opts.select);
  if (opts.where) params.set("where", opts.where);
  params.set("limit", String(opts.limit));
  params.set("offset", String(opts.offset));
  const url = `${API_BASE}/records?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`bofip-vigueur ${res.status}: ${await res.text().then((t) => t.slice(0, 200)).catch(() => "")}`);
  return await res.json();
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const internalToken = req.headers.get("x-internal-cron");
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isInternal = !!internalToken && !!cronSecret && internalToken === cronSecret;
    if (!isInternal) await requireSuperAdmin(req);

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const db = getAdminClient();
    const apiKey = getLovableApiKey();

    if (dryRun) {
      const sample = await fetchPage({ select: "identifiant_juridique,titre,serie,division,permalien,debut_de_validite", limit: 5, offset: 0 });
      return json({ dry_run: true, total_count: sample.total_count, sample: sample.results });
    }

    let batchId: string;
    let needsPlanning = false;
    const max = Number.isFinite(Number(body.max_docs)) && Number(body.max_docs) > 0 ? Number(body.max_docs) : Number.POSITIVE_INFINITY;

    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      batchId = await startBatch(db, "bofip-full", "documents", [], { planning: "in_progress", source: "data.economie.gouv.fr/bofip-vigueur" });
      needsPlanning = true;
    }

    // @ts-ignore EdgeRuntime injecté par Supabase
    EdgeRuntime.waitUntil((async () => {
      try {
        const start = Date.now();
        let ingested = 0, skipped = 0, failed = 0;
        let planningDone = !needsPlanning;

        const planTask = needsPlanning ? (async () => {
          let total = 0;
          const pageSize = 100;
          try {
            // 1ère page pour total_count
            const first = await fetchPage({ select: "identifiant_juridique,titre,serie,division,permalien,debut_de_validite", limit: pageSize, offset: 0 });
            const totalCount = first.total_count ?? 0;
            const pushItems = async (recs: BofipRecord[]) => {
              const items: BatchItem[] = recs
                .filter((r) => !!r.identifiant_juridique)
                .map((r) => ({ id: r.identifiant_juridique!, titre: r.titre, serie: r.serie, division: r.division, permalien: r.permalien, date: r.debut_de_validite }));
              if (!items.length) return;
              const slice = items.slice(0, Math.max(0, max - total));
              if (!slice.length) return;
              const { error } = await db.rpc("append_batch_items", { p_batch_id: batchId, p_items: slice });
              if (error) throw new Error(`append: ${error.message}`);
              total += slice.length;
            };
            await pushItems(first.results);
            for (let offset = pageSize; offset < totalCount && total < max; offset += pageSize) {
              const page = await fetchPage({ select: "identifiant_juridique,titre,serie,division,permalien,debut_de_validite", limit: pageSize, offset });
              await pushItems(page.results);
              if (!page.results.length) break;
            }
            console.log(`[bofip-full] planning fini: ${total}/${totalCount}`);
          } catch (e) {
            const msg = (e as Error).message;
            console.error(`[bofip-full] planning err: ${msg}`);
            await db.from("ingestion_batch_state")
              .update({ error_log: [{ at: new Date().toISOString(), stage: "planning", message: msg }] })
              .eq("id", batchId);
          } finally {
            planningDone = true;
          }
        })() : Promise.resolve();

        // Ingestion : pour chaque item, fetch contenu via API filter
        while (Date.now() - start < TIME_BUDGET_MS) {
          const items = await getNextItems<BatchItem>(db, batchId, 1);
          if (!items.length) {
            if (planningDone) break;
            await heartbeat(db, batchId);
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          await heartbeat(db, batchId);
          const it = items[0];
          let ing = 0, sk = 0, fail = false;
          let attempt = 0;
          const maxAttempts = 3;
          while (attempt < maxAttempts) {
            attempt++;
            try {
              const where = `identifiant_juridique="${it.id.replace(/"/g, '\\"')}"`;
              const det = await fetchPage({ select: "contenu,titre,debut_de_validite,permalien", where, limit: 1, offset: 0 });
              const rec = det.results[0];
              const text = (rec?.contenu ?? "").trim();
              if (!text || text.length < 80) {
                await markProcessed(db, batchId, [it], 0, 0);
              } else {
                const title = rec?.titre ?? it.titre ?? `BOFiP ${it.id}`;
                const loc = [it.serie, it.division].filter(Boolean).join(" / ");
                const content = `**BOFiP** · ${loc}\n\n# ${title}\n\n${text}`;
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "bofip", it.id, hash);
                if (!dec.shouldIngest) {
                  sk = 1;
                } else {
                  await ingestSource(db, apiKey, "bofip", {
                    external_id: it.id,
                    source_type: "doctrine_fiscale",
                    title: `BOFiP — ${title}`,
                    content,
                    reference_code: it.id,
                    official_url: rec?.permalien ?? it.permalien ?? `https://bofip.impots.gouv.fr/bofip/${it.id}`,
                    legal_date: (rec?.debut_de_validite ?? it.date) ?? null,
                    raw_metadata: { bofip_id: it.id, serie: it.serie, division: it.division, content_hash: hash },
                  });
                  ing = 1;
                }
                await markProcessed(db, batchId, [it], ing, sk);
              }
              break; // succès
            } catch (err) {
              const msg = (err as Error).message ?? "";
              const transient = /statement timeout|fetch failed|ECONNRESET|429|503|504|network|timeout/i.test(msg);
              if (transient && attempt < maxAttempts) {
                console.warn(`[bofip-full] ${it.id}: transient (${msg}), retry ${attempt}/${maxAttempts - 1}`);
                await heartbeat(db, batchId);
                await new Promise((r) => setTimeout(r, 1500 * attempt));
                continue;
              }
              fail = true;
              console.error(`[bofip-full] ${it.id}:`, msg);
              await markFailed(db, batchId, [it], msg);
              break;
            }
          }
          ingested += ing; skipped += sk; if (fail) failed++;
          await new Promise((r) => setTimeout(r, 80));
        }

        await planTask.catch(() => {});
        const fin = await finalizeBatch(db, batchId);
        console.log(`[connector-bofip-full] batch=${batchId} status=${fin.status} processed=${fin.processed}/${fin.total} ingested=${ingested} skipped=${skipped} failed=${failed}`);

        if (fin.status === "paused") {
          const cs = Deno.env.get("CRON_SECRET");
          const su = Deno.env.get("SUPABASE_URL");
          const srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (cs && su && srv) {
            try {
              await fetch(`${su}/functions/v1/connector-bofip-full`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-internal-cron": cs, "Authorization": `Bearer ${srv}` },
                body: JSON.stringify({ resume_batch_id: batchId }),
              });
              console.log(`[connector-bofip-full] auto-resume scheduled for batch ${batchId}`);
            } catch (e) {
              console.warn(`[connector-bofip-full] auto-resume failed:`, (e as Error).message);
            }
          }
        }
      } catch (err) {
        console.error(`[connector-bofip-full] background error:`, (err as Error).message);
      }
    })());

    return json({
      status: "started",
      message: "Ingestion BOFiP lancée (source data.economie.gouv.fr). Suivi dans Jobs récents.",
      batch_id: batchId,
    }, 202);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
