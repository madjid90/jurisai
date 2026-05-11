// connector-jade-full — Jurisprudence administrative (Conseil d'État) via PISTE Jade.
// Batch resumable. Mêmes patterns que judilibre-full.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";
import { stripHtml } from "../_shared/unist-extract.ts";

const TIME_BUDGET_MS = 60_000;
const JADE_BASE = "https://api.piste.gouv.fr/cassation/jade/v1.0";
const JADE_SANDBOX = "https://sandbox-api.piste.gouv.fr/cassation/jade/v1.0";
const baseUrl = () => Deno.env.get("PISTE_SANDBOX") === "1" ? JADE_SANDBOX : JADE_BASE;

interface Hit { id: string; juridiction?: string; date?: string; numero?: string; type?: string; solution?: string; }
interface BatchItem { id: string; juridiction?: string; date?: string; numero?: string; }

function getKey(): string {
  const k = Deno.env.get("PISTE_API_KEY");
  if (!k) throw new Error("PISTE_API_KEY manquant pour Jade.");
  return k;
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
    // Note: l'API REST « JADE » sur PISTE n'expose plus d'endpoint /search public.
    // Les décisions du Conseil d'État sont distribuées en archives mensuelles via
    // https://opendata.justice-administrative.fr (pas de recherche temps réel).
    // On renvoie une erreur explicite tant qu'un connecteur d'archives n'est pas en place.
    if (!body.resume_batch_id) {
      return json({
        error: "JADE PISTE indisponible",
        detail: "L'API REST JADE de PISTE a été décommissionnée. Les décisions du Conseil d'État sont désormais publiées en archives mensuelles sur opendata.justice-administrative.fr. Un connecteur dédié 'jade-archives' sera nécessaire pour les ingérer (à implémenter).",
        action_required: "implement_jade_archives_connector",
      }, 501);
    }
    const db = getAdminClient();
    const apiKey = getLovableApiKey();
    const key = getKey();

    let batchId: string;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      const dEnd: string = body.date_end ?? new Date().toISOString().slice(0, 10);
      const dStart: string = body.date_start ?? (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 5); return d.toISOString().slice(0, 10); })();
      const query: string = typeof body.query === "string" && body.query.trim() ? body.query.trim() : "*";
      // max_decisions = 0 (ou absent) => totalité disponible (pagination jusqu'à épuisement)
      const max = body.max_decisions === undefined ? 0 : Number(body.max_decisions);
      const unlimited = max <= 0;

      const collected: Hit[] = [];
      let page = 0; const pageSize = 50;
      while (unlimited || collected.length < max) {
        const url = `${baseUrl()}/search?` + new URLSearchParams({
          query, page: String(page), page_size: String(pageSize), date_start: dStart, date_end: dEnd,
        }).toString();
        const res = await fetch(url, { headers: { KeyId: key, apikey: key, Accept: "application/json" } });
        if (!res.ok) throw new Error(`Jade /search ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json() as { results?: Hit[]; result?: Hit[] };
        const hits = data.results ?? data.result ?? [];
        if (!hits.length) break;
        collected.push(...hits);
        if (hits.length < pageSize) break;
        page++;
      }

      const final = unlimited ? collected : collected.slice(0, max);
      const items: BatchItem[] = final.map((h) => ({ id: h.id, juridiction: h.juridiction, date: h.date, numero: h.numero }));
      if (dryRun) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "jade-full", "decisions", items, { query, dStart, dEnd });
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
                const res = await fetch(`${baseUrl()}/decision?id=${encodeURIComponent(it.id)}`, { headers: { KeyId: key, apikey: key, Accept: "application/json" } });
                if (!res.ok) throw new Error(`/decision ${res.status}`);
                const d = await res.json() as Hit & { text?: string; texte?: string; summary?: string; sommaire?: string };
                const raw = d.text ?? d.texte ?? d.summary ?? d.sommaire ?? "";
                const text = stripHtml(raw);
                if (!text || text.length < 100) { ok.push(it); continue; }

                const content = `**Conseil d'État** · ${d.juridiction ?? ""} · ${d.date ?? ""}\n\n# Décision ${d.numero ?? d.id}\n\n${text}`;
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "jade", d.id, hash);
                if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

                await ingestSource(db, apiKey, "jade", {
                  external_id: d.id,
                  source_type: "jurisprudence_administrative",
                  title: `CE ${d.juridiction ?? ""} ${d.date ?? ""} — ${d.numero ?? d.id}`.trim(),
                  content,
                  reference_code: d.numero ?? null,
                  official_url: `https://www.conseil-etat.fr/fr/arianeweb/CE/decision/${encodeURIComponent(d.id)}`,
                  legal_date: d.date ?? null,
                  raw_metadata: { juridiction: d.juridiction, type: d.type, solution: d.solution, content_hash: hash, jade_id: d.id },
                });
                ing++; ok.push(it);
              } catch (err) {
                fl.push(it);
                console.error(`[jade-full] ${it.id}:`, (err as Error).message);
              }
              await new Promise((r) => setTimeout(r, 100));
            }

            if (ok.length) await markProcessed(db, batchId, ok, ing, sk);
            if (fl.length) await markFailed(db, batchId, fl, "see logs");
            ingested += ing; skipped += sk; failed += fl.length;
          }

          const fin = await finalizeBatch(db, batchId);
          console.log(`[connector-jade-full] batch ${batchId} fini: status=${fin.status} processed=${fin.processed}/${fin.total} ingested=${ingested} skipped=${skipped} failed=${failed}`);

          if (fin.status === "paused") {
            const cs = Deno.env.get("CRON_SECRET");
            const su = Deno.env.get("SUPABASE_URL");
            if (cs && su) {
              try {
                await fetch(`${su}/functions/v1/connector-jade-full`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-internal-cron": cs,
                    "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
                  },
                  body: JSON.stringify({ resume_batch_id: batchId }),
                });
                console.log(`[connector-jade-full] auto-resume scheduled for batch ${batchId}`);
              } catch (e) {
                console.warn(`[connector-jade-full] auto-resume failed:`, (e as Error).message);
              }
            }
          }

      } catch (err) {

        console.error(`[connector-jade-full] background error:`, (err as Error).message);

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
