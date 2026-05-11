// connector-cdtn-fiches — Fiches pratiques Service-Public + Ministère du Travail.
// Source : sitemap.xml de code.travail.gouv.fr (l'ancienne items.json a été retirée).
// Pour chaque URL, on fetch le HTML et on extrait le contenu de <main>.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 60_000;
const CDTN_SITEMAP = "https://code.travail.gouv.fr/sitemap.xml";

interface BatchItem { slug: string; title: string; url: string; source: string; }

async function loadIndex(): Promise<BatchItem[]> {
  const res = await fetch(CDTN_SITEMAP);
  if (!res.ok) throw new Error(`CDTN sitemap ${res.status}`);
  const xml = await res.text();
  const urls = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
  const items: BatchItem[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const m = url.match(/^https:\/\/code\.travail\.gouv\.fr\/(fiche-service-public|fiche-ministere-travail)\/([^/?#]+)$/);
    if (!m) continue;
    const source = m[1] === "fiche-service-public" ? "fiches-service-public" : "fiches-ministere-travail";
    const slug = `${m[1]}/${m[2]}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const title = m[2].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    items.push({ slug, title, url, source });
  }
  return items;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function extractMainText(html: string): { title: string; body: string } {
  const titleM = html.match(/<title>([^<]+)<\/title>/);
  let title = titleM ? decodeEntities(titleM[1]).replace(/\s*-\s*Code du travail numérique\s*$/, "").trim() : "";

  const mainM = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  let body = mainM ? mainM[1] : html;
  body = body
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<nav[\s\S]*?<\/nav>/g, "")
    .replace(/<header[\s\S]*?<\/header>/g, "")
    .replace(/<footer[\s\S]*?<\/footer>/g, "")
    .replace(/<h([1-6])[^>]*>/g, (_, n) => "\n" + "#".repeat(parseInt(n, 10)) + " ")
    .replace(/<\/h[1-6]>/g, "\n")
    .replace(/<li[^>]*>/g, "\n- ")
    .replace(/<\/p>|<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, " ");
  body = decodeEntities(body)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Coupe le bloc UI "Avez-vous trouvé la réponse..." et tout ce qui suit
  const cutIdx = body.search(/(Avez-vous trouvé la réponse|Articles liés|Partager la page)/);
  if (cutIdx > 200) body = body.slice(0, cutIdx).trim();
  return { title, body };
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
    const db = getAdminClient();
    const apiKey = getLovableApiKey();

    let batchId: string;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      const items = await loadIndex();
      if (dryRun) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "cdtn-fiches", "fiches", items, {});
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
                const r = await fetch(it.url, { headers: { "user-agent": "JurisAI-bot/1.0" } });
                if (!r.ok) throw new Error(`fiche ${it.slug} HTTP ${r.status}`);
                const html = await r.text();
                const { title: extractedTitle, body: extractedBody } = extractMainText(html);

                if (!extractedBody || extractedBody.length < 200) { ok.push(it); continue; }

                const title = extractedTitle || it.title;
                const sourceLabel = it.source === "fiches-service-public" ? "Service-Public.fr" : "Ministère du Travail";
                const content = `**Source officielle** : ${sourceLabel}\n**URL** : ${it.url}\n\n# ${title}\n\n${extractedBody}`;
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "cdtn-fiches", it.slug, hash);
                if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

                await ingestSource(db, apiKey, "cdtn-fiches", {
                  external_id: it.slug,
                  source_type: it.source === "fiches-service-public" ? "fiche_service_public" : "fiche_ministere_travail",
                  title,
                  content,
                  official_url: it.url,
                  raw_metadata: { slug: it.slug, source: it.source, content_hash: hash },
                });
                ing++; ok.push(it);
              } catch (err) {
                fl.push(it);
                console.error(`[cdtn-fiches] ${it.slug}:`, (err as Error).message);
              }
            }

            if (ok.length) await markProcessed(db, batchId, ok, ing, sk);
            if (fl.length) await markFailed(db, batchId, fl, "see logs");
            ingested += ing; skipped += sk; failed += fl.length;
          }

          const fin = await finalizeBatch(db, batchId);
          console.log(`[connector-cdtn-fiches] batch ${batchId} fini: status=${fin.status} processed=${fin.processed}/${fin.total} ingested=${ingested} skipped=${skipped} failed=${failed}`);

          if (fin.status === "paused") {
            const cs = Deno.env.get("CRON_SECRET");
            const su = Deno.env.get("SUPABASE_URL");
            if (cs && su) {
              try {
                await fetch(`${su}/functions/v1/connector-cdtn-fiches-full`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-internal-cron": cs,
                    "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
                  },
                  body: JSON.stringify({ resume_batch_id: batchId }),
                });
                console.log(`[connector-cdtn-fiches-full] auto-resume scheduled for batch ${batchId}`);
              } catch (e) {
                console.warn(`[connector-cdtn-fiches-full] auto-resume failed:`, (e as Error).message);
              }
            }
          }

      } catch (err) {

        console.error(`[connector-cdtn-fiches] background error:`, (err as Error).message);

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
