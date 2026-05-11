// connector-bofip-full — BOFiP (doctrine fiscale) via PISTE BOFiP API.
// Batch resumable. Récupère les identifiants par paquets puis fetch détail.
//
// POST body: { resume_batch_id?: string, ids?: string[], dry_run?: boolean }
// Si pas d'ids fournis, tente de lister via /search.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";
import { stripHtml } from "../_shared/unist-extract.ts";
import { legifranceFetch } from "../_shared/piste.ts";

const TIME_BUDGET_MS = 60_000;

interface BatchItem { id: string; serie?: string; division?: string; titre?: string; }

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
    let planningMax: number | null = null;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      if (Array.isArray(body.ids) && body.ids.length) {
        const items: BatchItem[] = body.ids.map((id: string) => ({ id }));
        if (dryRun) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
        batchId = await startBatch(db, "bofip-full", "documents", items, {});
      } else {
        const max = Math.min(Number(body.max_docs) || 1000, 5000);
        if (dryRun) {
          // Échantillon rapide page 1
          const data = await legifranceFetch<{ results?: Array<{ id?: string; titre?: string }> }>(
            "/search",
            {
              recherche: {
                champs: [{ typeChamp: "ALL", criteres: [{ typeRecherche: "EXACTE", valeur: "*", operateur: "ET" }], operateur: "ET" }],
                filtres: [{ facette: "FONDS", valeurs: ["BOFIP"] }],
                pageNumber: 1, pageSize: 10, sort: "PERTINENCE", typePagination: "DEFAUT",
              },
              fond: "BOFIP",
            },
          ).catch(() => ({ results: [] as Array<{ id?: string; titre?: string }> }));
          return json({ dry_run: true, sample: (data.results ?? []).slice(0, 5) });
        }
        // Crée le batch vide, planning en arrière-plan
        batchId = await startBatch(db, "bofip-full", "documents", [], { planning: "in_progress", max });
        planningMax = max;
      }
    }

    // @ts-ignore EdgeRuntime injecté par Supabase

    EdgeRuntime.waitUntil((async () => {

      try {

          const start = Date.now();
          let ingested = 0, skipped = 0, failed = 0;
          let planningDone = planningMax === null;

          // Planification asynchrone : pagine /search BOFiP et append items au batch
          const planTask = planningMax !== null ? (async () => {
            const max = planningMax!;
            const pageSize = 50;
            let page = 1;
            let total = 0;
            try {
              while (total < max) {
                const data = await legifranceFetch<{ results?: Array<{ id?: string; titre?: string; serie?: string; division?: string }> }>(
                  "/search",
                  {
                    recherche: {
                      champs: [{ typeChamp: "ALL", criteres: [{ typeRecherche: "EXACTE", valeur: "*", operateur: "ET" }], operateur: "ET" }],
                      filtres: [{ facette: "FONDS", valeurs: ["BOFIP"] }],
                      pageNumber: page, pageSize, sort: "PERTINENCE", typePagination: "DEFAUT",
                    },
                    fond: "BOFIP",
                  },
                ).catch((e) => { console.warn("[bofip-full] plan p", page, ":", (e as Error).message); return { results: [] }; });
                const hits = data.results ?? [];
                if (!hits.length) break;
                const items: BatchItem[] = hits
                  .filter((h) => h.id)
                  .slice(0, max - total)
                  .map((h) => ({ id: h.id!, titre: h.titre, serie: h.serie, division: h.division }));
                if (items.length) {
                  const { error } = await db.rpc("append_batch_items", { p_batch_id: batchId, p_items: items });
                  if (error) console.error(`[bofip-full] append err: ${error.message}`);
                  total += items.length;
                }
                if (hits.length < pageSize) break;
                page++;
              }
            } finally {
              planningDone = true;
              console.log(`[bofip-full] planning fini: ${total} items`);
            }
          })() : Promise.resolve();

          while (Date.now() - start < TIME_BUDGET_MS) {
            const items = await getNextItems<BatchItem>(db, batchId, 1);
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
                const det = await legifranceFetch<{ document?: { id?: string; titre?: string; texte?: string; texteHtml?: string; dateDebut?: number } }>(
                  "/consult/getBofipById", { id: it.id },
                ).catch(async () => {
                  // fallback alternative endpoint
                  return await legifranceFetch<{ document?: { id?: string; titre?: string; texte?: string; texteHtml?: string; dateDebut?: number } }>(
                    "/consult/getDocBofipById", { id: it.id },
                  );
                });
                const raw = det.document?.texte ?? det.document?.texteHtml ?? "";
                const text = stripHtml(raw);
                if (!text || text.length < 100) { ok.push(it); continue; }

                const title = det.document?.titre ?? it.titre ?? `BOFiP ${it.id}`;
                const content = `**BOFiP** · ${it.serie ?? ""} ${it.division ?? ""}\n\n# ${title}\n\n${text}`;
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "bofip", it.id, hash);
                if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

                await ingestSource(db, apiKey, "bofip", {
                  external_id: it.id,
                  source_type: "doctrine_fiscale",
                  title: `BOFiP — ${title}`,
                  content,
                  reference_code: it.id,
                  official_url: `https://bofip.impots.gouv.fr/bofip/${it.id}`,
                  legal_date: det.document?.dateDebut ? new Date(det.document.dateDebut).toISOString().slice(0, 10) : null,
                  raw_metadata: { bofip_id: it.id, serie: it.serie, division: it.division, content_hash: hash },
                });
                ing++; ok.push(it);
              } catch (err) {
                fl.push(it);
                console.error(`[bofip-full] ${it.id}:`, (err as Error).message);
              }
              await new Promise((r) => setTimeout(r, 100));
            }

            if (ok.length) await markProcessed(db, batchId, ok, ing, sk);
            if (fl.length) await markFailed(db, batchId, fl, "see logs");
            ingested += ing; skipped += sk; failed += fl.length;
          }

          await planTask.catch(() => {});
          const fin = await finalizeBatch(db, batchId);
          console.log(`[connector-bofip-full] batch ${batchId} fini: status=${fin.status} processed=${fin.processed}/${fin.total} ingested=${ingested} skipped=${skipped} failed=${failed}`);

          if (fin.status === "paused") {
            const cs = Deno.env.get("CRON_SECRET");
            const su = Deno.env.get("SUPABASE_URL");
            if (cs && su) {
              try {
                await fetch(`${su}/functions/v1/connector-bofip-full`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-internal-cron": cs,
                    "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
                  },
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

      message: "Ingestion lancée en arrière-plan. Le batch apparaîtra dans Jobs récents sous ~10s.",

      batch_id: batchId,

    }, 202);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
