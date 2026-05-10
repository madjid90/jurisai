// connector-bofip-full — BOFiP (doctrine fiscale) via PISTE BOFiP API.
// Batch resumable. Récupère les identifiants par paquets puis fetch détail.
//
// POST body: { resume_batch_id?: string, ids?: string[], dry_run?: boolean }
// Si pas d'ids fournis, tente de lister via /search.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";
import { stripHtml } from "../_shared/unist-extract.ts";
import { legifranceFetch } from "../_shared/piste.ts";

const TIME_BUDGET_MS = 135_000;

interface BatchItem { id: string; serie?: string; division?: string; titre?: string; }

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const db = getAdminClient();
    const apiKey = getLovableApiKey();

    let batchId: string;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      let items: BatchItem[];
      if (Array.isArray(body.ids) && body.ids.length) {
        items = body.ids.map((id: string) => ({ id }));
      } else {
        // Search via Légifrance API (BOFiP est dispo via /search BOFiP)
        const max = Math.min(Number(body.max_docs) || 1000, 5000);
        const collected: BatchItem[] = [];
        let page = 1;
        const pageSize = 50;
        while (collected.length < max) {
          try {
            const data = await legifranceFetch<{ results?: Array<{ id?: string; titre?: string; serie?: string; division?: string }> }>(
              "/search",
              {
                recherche: {
                  champs: [{ typeChamp: "ALL", criteres: [{ typeRecherche: "EXACTE", valeur: "*", operateur: "ET" }], operateur: "ET" }],
                  filtres: [{ facette: "FONDS", valeurs: ["BOFIP"] }],
                  pageNumber: page,
                  pageSize,
                  sort: "PERTINENCE",
                  typePagination: "DEFAUT",
                },
                fond: "BOFIP",
              },
            );
            const hits = data.results ?? [];
            if (!hits.length) break;
            collected.push(...hits.filter((h) => h.id).map((h) => ({ id: h.id!, titre: h.titre, serie: h.serie, division: h.division })));
            if (hits.length < pageSize) break;
            page++;
          } catch (err) {
            console.warn("[bofip-full] search page", page, "failed:", (err as Error).message);
            break;
          }
        }
        items = collected.slice(0, max);
      }

      if (dryRun) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "bofip-full", "documents", items, {});
    }

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

    const fin = await finalizeBatch(db, batchId);
    return json({ batch_id: batchId, status: fin.status, processed: fin.processed, total: fin.total, ingested, skipped_unchanged: skipped, failed });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
