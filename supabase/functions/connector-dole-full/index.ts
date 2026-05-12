// connector-dole-full — Dossiers législatifs Légifrance via PISTE OAuth.
// Batch resumable. Veille proactive sur les lois en préparation.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 60_000;
const VIE_PUBLIQUE_BASE = "https://www.vie-publique.fr";
interface BatchItem { id: string; title: string; nature?: string; date?: string; url: string; }

const MONTHS: Record<string, string> = {
  janvier: "01",
  fevrier: "02",
  février: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  aout: "08",
  août: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  decembre: "12",
  décembre: "12",
};

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMonth(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseFrenchDate(value: string): string | undefined {
  const match = value.match(/\b(\d{1,2}|1er)\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})\b/u);
  if (!match) return undefined;
  const day = String(match[1] === "1er" ? 1 : Number(match[1])).padStart(2, "0");
  const month = MONTHS[normalizeMonth(match[2])];
  if (!month) return undefined;
  return `${match[3]}-${month}-${day}`;
}

function inferNature(title: string): string | undefined {
  const lower = title.toLowerCase();
  if (lower.startsWith("ordonnance")) return "ordonnance";
  if (lower.startsWith("loi organique")) return "loi organique";
  if (lower.startsWith("loi")) return "loi";
  if (lower.startsWith("projet de loi")) return "projet de loi";
  if (lower.startsWith("proposition de loi")) return "proposition de loi";
  return undefined;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: "text/html,application/xhtml+xml" } });
  if (!res.ok) throw new Error(`Vie publique ${res.status} on ${url}`);
  return await res.text();
}

function parseHtml(html: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Impossible de parser la page Vie publique");
  return doc;
}

async function listLegislatureUrls(): Promise<string[]> {
  const html = await fetchHtml(`${VIE_PUBLIQUE_BASE}/liste/legislatures`);
  const doc = parseHtml(html);
  const urls = new Set<string>();
  for (const a of doc.querySelectorAll('a[href*="/liste/dossierslegislatifs/"]')) {
    const href = a.getAttribute("href");
    if (!href) continue;
    urls.add(href.startsWith("http") ? href : `${VIE_PUBLIQUE_BASE}${href}`);
  }
  return [...urls];
}

async function loadIndex(months: number, max: number): Promise<BatchItem[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const out: BatchItem[] = [];
  const seen = new Set<string>();
  const legislatureUrls = await listLegislatureUrls();

  for (const pageUrl of legislatureUrls) {
    if (out.length >= max) break;
    const html = await fetchHtml(pageUrl);
    const doc = parseHtml(html);
    const links = doc.querySelectorAll('a[href*="/dossierlegislatif/"]');
    for (const link of links) {
      const href = link.getAttribute("href");
      const title = normalizeText(link.textContent ?? "");
      if (!href || !title) continue;
      const match = href.match(/\/dossierlegislatif\/([^/?#]+)/);
      if (!match) continue;
      const id = match[1];
      if (seen.has(id)) continue;
      const date = parseFrenchDate(title);
      if (date && new Date(`${date}T00:00:00Z`) < since) continue;
      if (!date && pageUrl !== legislatureUrls[0]) continue;
      seen.add(id);
      out.push({
        id,
        title,
        nature: inferNature(title),
        date,
        url: href.startsWith("http") ? href : `${VIE_PUBLIQUE_BASE}${href}`,
      });
      if (out.length >= max) break;
    }
  }

  return out;
}

async function fetchDossier(url: string) {
  try {
    const html = await fetchHtml(url);
    const doc = parseHtml(html);
    const main = doc.querySelector("main") ?? doc.body;
    for (const node of main.querySelectorAll("script, style, noscript")) node.remove();

    const title = normalizeText(doc.querySelector("h1")?.textContent ?? "");
    const officialUrl = (doc.querySelector('a[href*="legifrance.gouv.fr/"]')?.getAttribute("href") ?? "").trim() || url;

    const blocks: string[] = [];
    for (const node of main.querySelectorAll("h2, h3, h4, p, li")) {
      const text = normalizeText(node.textContent ?? "");
      if (!text || text.length < 3) continue;
      if (text.startsWith("Accepter") || text.startsWith("Refuser") || text.startsWith("Gérer les cookies")) continue;
      blocks.push(text);
    }

    const deduped = blocks.filter((text, index) => blocks.indexOf(text) === index);
    return {
      title,
      officialUrl,
      body: deduped.join("\n\n").slice(0, 60_000),
    };
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
