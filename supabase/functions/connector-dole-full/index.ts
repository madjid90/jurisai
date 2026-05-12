// connector-dole-full — Dossiers législatifs Légifrance via PISTE OAuth.
// Batch resumable. Veille proactive sur les lois en préparation.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { UntarStream } from "jsr:@std/tar/untar-stream";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 60_000;
const DOLE_OPEN_DATA_INDEX = "https://echanges.dila.gouv.fr/OPENDATA/DOLE/";
const LEGIFRANCE_DOSSIER_BASE = "https://www.legifrance.gouv.fr/dossierlegislatif/";
interface BatchItem { id: string; title: string; nature?: string; date?: string; content: string; officialUrl: string; }

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function nodeText(parent: Element, selector: string): string {
  return normalizeText(parent.querySelector(selector)?.textContent ?? "");
}

function xmlSection(parent: Element, selector: string, heading: string): string | null {
  const node = parent.querySelector(selector);
  if (!node) return null;
  const text = normalizeText(node.textContent ?? "");
  if (!text) return null;
  return `## ${heading}\n\n${text}`;
}

function inferNatureFromType(type: string): string | undefined {
  switch (type) {
    case "LOI_PUBLIEE": return "loi";
    case "LOI_ORGANIQUE": return "loi organique";
    case "ORDONNANCE": return "ordonnance";
    case "PROJET_LOI": return "projet de loi";
    case "PROPOSITION_LOI": return "proposition de loi";
    default: return type ? type.toLowerCase() : undefined;
  }
}

async function latestOpenDataArchiveUrl(): Promise<string> {
  const res = await fetch(DOLE_OPEN_DATA_INDEX);
  if (!res.ok) throw new Error(`DOLE open data index ${res.status}`);
  const html = await res.text();
  const names = [...html.matchAll(/href="(DOLE_[^"]+\.tar\.gz)"/g)].map((m) => m[1]);
  const latest = names.sort().at(-1);
  if (!latest) throw new Error("Aucune archive DOLE trouvée dans l'open data DILA");
  return `${DOLE_OPEN_DATA_INDEX}${latest}`;
}

async function loadIndex(months: number, max: number): Promise<BatchItem[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const archiveUrl = await latestOpenDataArchiveUrl();
  const res = await fetch(archiveUrl);
  if (!res.ok) throw new Error(`DOLE archive ${res.status}`);
  if (!res.body) throw new Error("Archive DOLE vide");

  const untar = res.body
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new UntarStream());
  const out: BatchItem[] = [];
  const seen = new Set<string>();

  for await (const entry of untar) {
    if (entry.header.type !== "file" || !entry.path.endsWith(".xml") || !entry.readable) continue;
    const text = await new Response(entry.readable).text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const root = doc?.querySelector("DOSSIER_LEGISLATIF");
    if (!root) continue;

    const meta = root.querySelector("META_DOSSIER_LEGISLATIF");
    if (!meta) continue;
    const id = nodeText(root, "META_COMMUN > ID");
    const title = nodeText(meta, "TITRE");
    const date = nodeText(meta, "DATE_DERNIERE_MODIFICATION") || nodeText(meta, "DATE_CREATION");
    if (!id || !title || seen.has(id)) continue;
    if (date && new Date(`${date}T00:00:00Z`) < since) continue;

    const contenu = root.querySelector("CONTENU");
    const parts = [
      xmlSection(contenu ?? root, "EXPOSE_MOTIF", "Exposé des motifs"),
      xmlSection(contenu ?? root, "TEXTE_ADOPTE", "Texte adopté"),
      xmlSection(contenu ?? root, "ECHEANCIER", "Échéancier"),
      xmlSection(contenu ?? root, "TEXTE_DEPOT", "Texte déposé"),
      xmlSection(contenu ?? root, "RAPPORTS", "Rapports"),
      xmlSection(contenu ?? root, "TRAVAUX_PREPARATOIRES", "Travaux préparatoires"),
      xmlSection(contenu ?? root, "CONTENU", "Contenu"),
    ].filter(Boolean) as string[];
    const content = parts.join("\n\n").replace(/\s+/g, " ").trim();

    seen.add(id);
    out.push({
      id,
      title,
      nature: inferNatureFromType(nodeText(meta, "TYPE")),
      date: date || undefined,
      content,
      officialUrl: `${LEGIFRANCE_DOSSIER_BASE}${id}`,
    });
    if (out.length >= max) break;
  }

  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
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
                const d = await fetchDossier(it.url);
                let body = "";
                if (d) {
                  body = d.body;
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
                  title: (d?.title || it.title).slice(0, 500),
                  content,
                  official_url: d?.officialUrl ?? it.url,
                  legal_date: it.date ? it.date.slice(0, 10) : null,
                  raw_metadata: { nature: it.nature, content_hash: hash, source_url: it.url },
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
