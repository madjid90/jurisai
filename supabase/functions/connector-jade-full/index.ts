// connector-jade-full — Jurisprudence administrative (Conseil d'État) via PISTE Jade.
// Batch resumable. Mêmes patterns que judilibre-full.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";
import { stripHtml } from "../_shared/unist-extract.ts";

const TIME_BUDGET_MS = 135_000;
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
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
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
      const max = Math.min(Number(body.max_decisions) || 3000, 15000);

      const collected: Hit[] = [];
      let page = 0; const pageSize = 50;
      while (collected.length < max) {
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

      const items: BatchItem[] = collected.slice(0, max).map((h) => ({ id: h.id, juridiction: h.juridiction, date: h.date, numero: h.numero }));
      if (dryRun) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "jade-full", "decisions", items, { query, dStart, dEnd });
    }

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

          await ingestSource(db, apiKey, "judilibre" /* RAG bucket */, {
            external_id: `jade:${d.id}`,
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
    return json({ batch_id: batchId, status: fin.status, processed: fin.processed, total: fin.total, ingested, skipped_unchanged: skipped, failed });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
