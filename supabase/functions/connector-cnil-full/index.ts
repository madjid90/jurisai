// connector-cnil-full — Délibérations CNIL via PISTE Légifrance fond CNIL.
// Sanctions disponibles via natures spécifiques. Batch resumable, SHA-256.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 60_000;
const PISTE_OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const PISTE_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";

interface BatchItem { id: string; title: string; date?: string; nature?: string; }

async function getPisteToken(): Promise<string> {
  const id = Deno.env.get("LEGIFRANCE_OAUTH_ID");
  const secret = Deno.env.get("LEGIFRANCE_OAUTH_SECRET");
  if (!id || !secret) throw new Error("Missing LEGIFRANCE_OAUTH_ID / LEGIFRANCE_OAUTH_SECRET");
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret, scope: "openid" });
  const r = await fetch(PISTE_OAUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`PISTE OAuth ${r.status}`);
  return (await r.json() as { access_token: string }).access_token;
}

async function searchCnil(token: string, dateStart: string, page: number, pageSize: number) {
  const payload = {
    fond: "CNIL",
    recherche: {
      filtres: [{ facette: "DATE_SIGNATURE", dates: { start: dateStart, end: new Date().toISOString().slice(0, 10) } }],
      pageNumber: page, pageSize, sort: "SIGNATURE_DATE_DESC",
      typePagination: "DEFAUT", operateur: "ET",
    },
  };
  const r = await fetch(`${PISTE_BASE}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`CNIL search ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json() as { results?: Array<{ titles?: Array<{ id: string; title: string }>; date?: string; nature?: string }>; totalResultNumber?: number };
}

async function loadIndex(token: string, months: number, max: number): Promise<BatchItem[]> {
  const since = new Date(); since.setMonth(since.getMonth() - months);
  const dateStart = since.toISOString().slice(0, 10);
  const out: BatchItem[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 400 && out.length < max; page++) {
    const res = await searchCnil(token, dateStart, page, 50);
    const arr = res.results ?? [];
    if (!arr.length) break;
    for (const r of arr) {
      const t = r.titles?.[0];
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ id: t.id, title: t.title, date: r.date, nature: r.nature });
      if (out.length >= max) break;
    }
  }
  return out;
}

async function fetchCnil(token: string, id: string) {
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
  const parts: string[] = ["**Source officielle** : CNIL — Légifrance"];
  parts.push(`# ${t.title ?? fallbackTitle}`);
  if (t.nature) parts.push(`**Nature** : ${t.nature}`);
  if (t.date) parts.push(`**Date** : ${t.date}`);
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
    const internalToken = req.headers.get("x-internal-cron");
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isInternal = !!internalToken && !!cronSecret && internalToken === cronSecret;
    if (!isInternal) await requireSuperAdmin(req);

    const body = await req.json().catch(() => ({})) as {
      dry_run?: boolean; months?: number; max_items?: number; max_per_type?: number; resume_batch_id?: string;
    };
    const db = getAdminClient();
    const apiKey = getLovableApiKey();
    const token = await getPisteToken();

    let batchId: string;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      const months = body.months ?? 36;
      const max = body.max_items ?? body.max_per_type ?? 1000;
      const items = await loadIndex(token, months, max);
      if (body.dry_run) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "cnil-full", "cnil_articles", items, { months, max });
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
              const a = await fetchCnil(token, it.id);
              const content = a ? buildContent(a, it.title) : `**CNIL** ${it.title} (${it.date ?? ""})`;
              if (content.length < 100) { sk++; ok.push(it); continue; }
              const hash = await sha256(content);
              const dec = await shouldIngest(db, "cnil-full", it.id, hash);
              if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

              const sourceType = (it.nature ?? a?.nature ?? "").toLowerCase().includes("sanction") ? "cnil_sanction" : "cnil_deliberation";
              await ingestSource(db, apiKey, "cnil", {
                external_id: it.id,
                source_type: sourceType,
                title: (a?.title ?? it.title).slice(0, 500),
                content,
                official_url: `https://www.legifrance.gouv.fr/cnil/id/${it.id}`,
                legal_date: (a?.date ?? it.date) ? (a?.date ?? it.date)!.slice(0, 10) : null,
                raw_metadata: { nature: a?.nature ?? it.nature, content_hash: hash },
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
        console.log(`[connector-cnil-full] batch ${batchId} fini: status=${fin.status} processed=${fin.processed}/${fin.total} ingested=${ingested} skipped=${skipped} failed=${failed}`);

        if (fin.status === "paused") {
          const cs = Deno.env.get("CRON_SECRET");
          const su = Deno.env.get("SUPABASE_URL");
          if (cs && su) {
            try {
              await fetch(`${su}/functions/v1/connector-cnil-full`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-internal-cron": cs,
                  "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
                },
                body: JSON.stringify({ resume_batch_id: batchId }),
              });
              console.log(`[connector-cnil-full] auto-resume scheduled for batch ${batchId}`);
            } catch (e) {
              console.warn(`[connector-cnil-full] auto-resume failed:`, (e as Error).message);
            }
          }
        }
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
