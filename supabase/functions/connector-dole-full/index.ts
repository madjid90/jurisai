// connector-dole-full — Dossiers législatifs Légifrance via Open Data DILA.
// Stream l'archive .tar.gz, extraction XML par regex, batch resumable.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { UntarStream } from "jsr:@std/tar/untar-stream";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 60_000;
const DOLE_OPEN_DATA_INDEX = "https://echanges.dila.gouv.fr/OPENDATA/DOLE/";
const LEGIFRANCE_DOSSIER_BASE = "https://www.legifrance.gouv.fr/dossierlegislatif/";

interface BatchItem {
  id: string;
  title: string;
  nature?: string;
  date?: string;
  content: string;
  officialUrl: string;
}

function normalizeText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function pick(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? normalizeText(m[1]) : "";
}

function pickSection(xml: string, tag: string, heading: string): string | null {
  const text = pick(xml, tag);
  return text ? `## ${heading}\n\n${text}` : null;
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

function archiveDate(name: string): string {
  // Freemium_dole_global_YYYYMMDD-HHMMSS.tar.gz | DOLE_YYYYMMDD-HHMMSS.tar.gz
  const m = name.match(/(\d{8})-\d{6}\.tar\.gz$/);
  return m ? m[1] : "";
}

async function listOpenDataArchives(maxArchives: number, includeBase: boolean): Promise<string[]> {
  const res = await fetch(DOLE_OPEN_DATA_INDEX);
  if (!res.ok) throw new Error(`DOLE open data index ${res.status}`);
  const html = await res.text();
  const all = [...html.matchAll(/href="((?:Freemium_dole_global_|DOLE_)[^"]+\.tar\.gz)"/g)].map((m) => m[1]);

  // Pour la veille : on prend SEULEMENT les N incréments les plus récents.
  // Le snapshot global Freemium n'est téléchargé que sur demande explicite (premier seed).
  const incrs = all.filter((n) => n.startsWith("DOLE_")).sort();
  const recentIncrs = incrs.slice(-maxArchives);
  if (!includeBase) return recentIncrs;

  const freemium = all.filter((n) => n.startsWith("Freemium_dole_global_")).sort();
  const base = freemium.at(-1);
  return base ? [base, ...recentIncrs] : recentIncrs;
}

async function ingestArchive(
  url: string,
  since: Date,
  max: number,
  out: BatchItem[],
  seen: Set<string>,
): Promise<void> {
  console.log(`[dole-full] download archive ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DOLE archive ${res.status}`);
  if (!res.body) throw new Error("Archive DOLE vide");

  const untar = res.body
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new UntarStream());

  for await (const entry of untar) {
    if (entry.header.type !== "file" || !entry.path.endsWith(".xml") || !entry.readable) {
      if (entry.readable) await entry.readable.cancel();
      continue;
    }
    const text = await new Response(entry.readable).text();
    if (!text.includes("<DOSSIER_LEGISLATIF")) continue;

    const id = pick(text, "ID");
    const title = pick(text, "TITRE");
    const date = pick(text, "DATE_DERNIERE_MODIFICATION") || pick(text, "DATE_CREATION");
    if (!id || !title) continue;
    if (date && new Date(`${date.slice(0, 10)}T00:00:00Z`) < since) continue;

    const parts = [
      pickSection(text, "EXPOSE_MOTIF", "Exposé des motifs"),
      pickSection(text, "TEXTE_ADOPTE", "Texte adopté"),
      pickSection(text, "ECHEANCIER", "Échéancier"),
      pickSection(text, "TEXTE_DEPOT", "Texte déposé"),
      pickSection(text, "TRAVAUX_PREPARATOIRES", "Travaux préparatoires"),
    ].filter(Boolean) as string[];
    const content = parts.join("\n\n").trim();

    // Les incréments écrasent l'entrée précédente du même id (mise à jour).
    const existingIdx = out.findIndex((b) => b.id === id);
    const item: BatchItem = {
      id,
      title,
      nature: inferNatureFromType(pick(text, "TYPE")),
      date: date || undefined,
      content,
      officialUrl: `${LEGIFRANCE_DOSSIER_BASE}${id}`,
    };
    if (existingIdx >= 0) {
      out[existingIdx] = item;
    } else {
      if (seen.size >= max) continue;
      seen.add(id);
      out.push(item);
    }
  }
}

async function loadIndex(
  months: number,
  max: number,
  opts: { maxArchives?: number; includeBase?: boolean } = {},
): Promise<BatchItem[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const maxArchives = opts.maxArchives ?? 5;
  const includeBase = opts.includeBase ?? false;
  const archives = await listOpenDataArchives(maxArchives, includeBase);
  console.log(`[dole-full] ${archives.length} archives à traiter (base=${includeBase}, max=${maxArchives})`);
  const out: BatchItem[] = [];
  const seen = new Set<string>();

  for (const name of archives) {
    try {
      await ingestArchive(`${DOLE_OPEN_DATA_INDEX}${name}`, since, max, out, seen);
    } catch (e) {
      console.warn(`[dole-full] archive ${name} ignorée: ${(e as Error).message}`);
    }
    if (seen.size >= max) break;
  }

  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

async function runBackground(
  db: ReturnType<typeof getAdminClient>,
  apiKey: string,
  body: { months?: number; max_dossiers?: number; resume_batch_id?: string; max_archives?: number; include_base?: boolean },
): Promise<void> {
  let batchId: string;
  if (body.resume_batch_id) {
    batchId = String(body.resume_batch_id);
  } else {
    const items = await loadIndex(body.months ?? 3, body.max_dossiers ?? 200, {
      maxArchives: body.max_archives ?? 5,
      includeBase: body.include_base ?? false,
    });
    console.log(`[dole-full] index built: ${items.length} dossiers`);
    batchId = await startBatch(db, "dole-full", "dossiers", items, { months: body.months ?? 3 });
  }


  const start = Date.now();
  let ingested = 0, skipped = 0, failed = 0;

  while (Date.now() - start < TIME_BUDGET_MS) {
    const items = await getNextItems<BatchItem>(db, batchId, 5);
    if (!items.length) break;
    await heartbeat(db, batchId);
    const ok: BatchItem[] = [], fl: BatchItem[] = [];
    let ing = 0, sk = 0;

    for (const it of items) {
      if (Date.now() - start > TIME_BUDGET_MS) break;
      try {
        const body = (it.content && it.content.length >= 50)
          ? it.content
          : `Dossier législatif ${it.title} (${it.nature ?? "loi"}, ${it.date ?? ""})`;
        const content = `**Source officielle** : Légifrance — Dossier législatif\n\n# ${it.title}\n\n${body}`;
        const hash = await sha256(content);
        const dec = await shouldIngest(db, "dole-full", it.id, hash);
        if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

        await ingestSource(db, apiKey, "dole", {
          external_id: it.id,
          source_type: "dossier_legislatif",
          title: it.title.slice(0, 500),
          content,
          official_url: it.officialUrl,
          legal_date: it.date ? it.date.slice(0, 10) : null,
          raw_metadata: { nature: it.nature, content_hash: hash, source_url: it.officialUrl },
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
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const internalToken = req.headers.get("x-internal-cron");
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isInternal = !!internalToken && !!cronSecret && internalToken === cronSecret;
    if (!isInternal) {
      await requireSuperAdmin(req);
    }
    const body = await req.json().catch(() => ({})) as { dry_run?: boolean; months?: number; max_dossiers?: number; resume_batch_id?: string };
    const db = getAdminClient();
    const apiKey = getLovableApiKey();

    if (body.dry_run) {
      // Dry-run synchronous: limite stricte pour rester sous le timeout gateway.
      const items = await loadIndex(body.months ?? 24, Math.min(body.max_dossiers ?? 20, 20));
      return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
    }

    // @ts-ignore EdgeRuntime injecté par Supabase
    EdgeRuntime.waitUntil(
      runBackground(db, apiKey, body).catch((err) => {
        console.error(`[connector-dole-full] background error:`, (err as Error).message);
      }),
    );

    return json({
      status: "started",
      message: "Ingestion lancée en arrière-plan. Le batch apparaîtra dans Jobs récents sous ~10s.",
    }, 202);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
