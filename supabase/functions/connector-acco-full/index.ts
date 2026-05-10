// connector-acco-full — Accords d'entreprise via PISTE Légifrance fond ACCO.
// Batch resumable, SHA-256 incrémental.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 135_000;
const PISTE_OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const PISTE_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";

interface BatchItem { id: string; title: string; date?: string; }

async function getPisteToken(): Promise<string> {
  const id = Deno.env.get("LEGIFRANCE_OAUTH_ID");
  const secret = Deno.env.get("LEGIFRANCE_OAUTH_SECRET");
  if (!id || !secret) throw new Error("Missing LEGIFRANCE_OAUTH_ID / LEGIFRANCE_OAUTH_SECRET");
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret, scope: "openid" });
  const r = await fetch(PISTE_OAUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`PISTE OAuth ${r.status}`);
  return (await r.json() as { access_token: string }).access_token;
}

async function searchAcco(token: string, query: string | undefined, dateStart: string, page: number, pageSize: number) {
  const payload = {
    fond: "ACCO",
    recherche: {
      filtres: [{ facette: "DATE_SIGNATURE", dates: { start: dateStart, end: new Date().toISOString().slice(0, 10) } }],
      pageNumber: page, pageSize, sort: "SIGNATURE_DATE_DESC",
      typePagination: "ARTICLE", operateur: "ET",
      ...(query ? { champs: [{ typeChamp: "TEXTE", criteres: [{ typeRecherche: "EXACTE", valeur: query, operateur: "ET" }], operateur: "ET" }] } : {}),
    },
  };
  const r = await fetch(`${PISTE_BASE}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`ACCO search ${r.status}`);
  return await r.json() as { results?: Array<{ titles?: Array<{ id: string; title: string }>; date?: string }> };
}

async function loadIndex(token: string, query: string | undefined, months: number, max: number): Promise<BatchItem[]> {
  const since = new Date(); since.setMonth(since.getMonth() - months);
  const dateStart = since.toISOString().slice(0, 10);
  const out: BatchItem[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 50 && out.length < max; page++) {
    const res = await searchAcco(token, query, dateStart, page, 50);
    const arr = res.results ?? [];
    if (!arr.length) break;
    for (const r of arr) {
      const t = r.titles?.[0];
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ id: t.id, title: t.title, date: r.date });
      if (out.length >= max) break;
    }
  }
  return out;
}

async function fetchAccord(token: string, id: string) {
  const r = await fetch(`${PISTE_BASE}/consult/jorf`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ textCid: id }),
  });
  if (!r.ok) return null;
  return await r.json() as {
    title?: string; nature?: string; date?: string; texte?: string; visa?: string; notice?: string;
    sections?: Array<{ title?: string; contenu?: string; articles?: Array<{ num?: string; content?: string }> }>;
  };
}

function buildContent(t: { title?: string; nature?: string; date?: string; texte?: string; visa?: string; notice?: string; sections?: Array<{ title?: string; contenu?: string; articles?: Array<{ num?: string; content?: string }> }> }, fallbackTitle: string): string {
  const parts: string[] = ["**Source officielle** : Légifrance — Accord d'entreprise"];
  parts.push(`# ${t.title ?? fallbackTitle}`);
  if (t.nature) parts.push(`**Nature** : ${t.nature}`);
  if (t.date) parts.push(`**Date de signature** : ${t.date}`);
  if (t.visa) parts.push(`## Visa\n${t.visa}`);
  if (t.notice) parts.push(`## Notice\n${t.notice}`);
  if (t.texte) parts.push(`## Texte\n${t.texte}`);
  if (t.sections?.length) {
    for (const sec of t.sections) {
      if (sec.title) parts.push(`### ${sec.title}`);
      if (sec.contenu) parts.push(sec.contenu);
      for (const a of sec.articles ?? []) {
        if (a.num) parts.push(`**Article ${a.num}**`);
        if (a.content) parts.push(a.content);
      }
    }
  }
  return parts.join("\n\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({})) as {
      dry_run?: boolean; query?: string; months?: number; max_accords?: number; resume_batch_id?: string;
    };
    const db = getAdminClient();
    const apiKey = getLovableApiKey();
    const token = await getPisteToken();

    let batchId: string;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      const items = await loadIndex(token, body.query, body.months ?? 12, body.max_accords ?? 500);
      if (body.dry_run) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "acco-full", "accords", items, { query: body.query ?? null, months: body.months ?? 12 });
    }

    // @ts-ignore EdgeRuntime injecté par Supabase

    EdgeRuntime.waitUntil((async () => {

      try {

          const start = Date.now();
          let ingested = 0, skipped = 0, failed = 0;

          while (Date.now() - start < TIME_BUDGET_MS) {
            const items = await getNextItems<BatchItem>(db, batchId, 8);
            if (!items.length) break;
            const ok: BatchItem[] = [], fl: BatchItem[] = [];
            let ing = 0, sk = 0;

            for (const it of items) {
              if (Date.now() - start > TIME_BUDGET_MS) break;
              try {
                const a = await fetchAccord(token, it.id);
                const content = a ? buildContent(a, it.title) : `**Accord d'entreprise** ${it.title} (${it.date ?? ""})`;
                if (content.length < 100) { sk++; ok.push(it); continue; }
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "acco-full", it.id, hash);
                if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

                await ingestSource(db, apiKey, "acco-full", {
                  external_id: it.id,
                  source_type: "accord_entreprise",
                  title: (a?.title ?? it.title).slice(0, 500),
                  content,
                  official_url: `https://www.legifrance.gouv.fr/jorf/id/${it.id}`,
                  legal_date: (a?.date ?? it.date) ? (a?.date ?? it.date)!.slice(0, 10) : null,
                  raw_metadata: { nature: a?.nature, content_hash: hash },
                });
                ing++; ok.push(it);
              } catch (err) {
                fl.push(it);
                console.error(`[acco-full] ${it.id}:`, (err as Error).message);
              }
            }

            if (ok.length) await markProcessed(db, batchId, ok, ing, sk);
            if (fl.length) await markFailed(db, batchId, fl, "see logs");
            ingested += ing; skipped += sk; failed += fl.length;
          }

          const fin = await finalizeBatch(db, batchId);
          console.log(`[connector-acco-full] batch ${batchId} fini: status=${fin.status} processed=${fin.processed}/${fin.total} ingested=${ingested} skipped=${skipped} failed=${failed}`);

      } catch (err) {

        console.error(`[connector-acco-full] background error:`, (err as Error).message);

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
