// connector-legifrance-full — Codes Légifrance via PISTE, version COMPLÈTE.
// 1 row par article (avec section_path), SHA-256 incrémental, batch resumable.
//
// POST body: { codes?: string[], resume_batch_id?: string, dry_run?: boolean }
// codes par défaut: ["LEGITEXT000006072050"] (Code du travail).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { legifranceFetch } from "../_shared/piste.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";
import { stripHtml } from "../_shared/unist-extract.ts";

// Budget conservateur : Supabase coupe sur "CPU Time exceeded" bien avant
// la limite wall-clock. 60s laisse la marge pour finalizeBatch + auto-resume.
const TIME_BUDGET_MS = 60_000;
// Codes prioritaires PME (transverse : RH + commercial + sociétés + fiscal + administratif)
const DEFAULT_CODES = [
  "LEGITEXT000006072050", // Code du travail
  "LEGITEXT000006070721", // Code civil
  "LEGITEXT000005634379", // Code de commerce
  "LEGITEXT000006069577", // Code général des impôts (CGI)
  "LEGITEXT000006073189", // Code de la sécurité sociale
  "LEGITEXT000006069565", // Code de la consommation
  "LEGITEXT000006069414", // Code de la propriété intellectuelle
  "LEGITEXT000006073984", // Code des assurances
  "LEGITEXT000006074068", // Code rural et de la pêche maritime
  "LEGITEXT000006069576", // Livre des procédures fiscales
  "LEGITEXT000006074075", // Code de l'urbanisme
  "LEGITEXT000006074069", // Code de l'environnement
  "LEGITEXT000006074073", // Code de la santé publique
  "LEGITEXT000006070716", // Code de procédure civile
  "LEGITEXT000006070719", // Code pénal
  "LEGITEXT000006071154", // Code de procédure pénale
  "LEGITEXT000006074093", // Code de l'action sociale et des familles
];

const KNOWN_CODES: Record<string, string> = {
  "LEGITEXT000006072050": "Code du travail",
  "LEGITEXT000006070721": "Code civil",
  "LEGITEXT000005634379": "Code de commerce",
  "LEGITEXT000006069577": "Code général des impôts",
  "LEGITEXT000006073189": "Code de la sécurité sociale",
  "LEGITEXT000006069565": "Code de la consommation",
  "LEGITEXT000006069414": "Code de la propriété intellectuelle",
  "LEGITEXT000006073984": "Code des assurances",
  "LEGITEXT000006074068": "Code rural et de la pêche maritime",
  "LEGITEXT000006069576": "Livre des procédures fiscales",
  "LEGITEXT000006074075": "Code de l'urbanisme",
  "LEGITEXT000006074069": "Code de l'environnement",
  "LEGITEXT000006074073": "Code de la santé publique",
  "LEGITEXT000006070716": "Code de procédure civile",
  "LEGITEXT000006070719": "Code pénal",
  "LEGITEXT000006071154": "Code de procédure pénale",
  "LEGITEXT000006074093": "Code de l'action sociale et des familles",
};

// `unpkg.com/@socialgouv/legi-data` renvoie HTTP 500 (package > 150 MB CDN limit).
// On bascule sur raw.githubusercontent (stable, pas de quota CDN) avec esm.sh en secours.
const LEGI_INDEX_URLS = [
  "https://raw.githubusercontent.com/SocialGouv/legi-data/master/data/index.json",
  "https://esm.sh/@socialgouv/legi-data/data/index.json",
];
async function fetchAllCodes(): Promise<string[]> {
  let lastErr: unknown = null;
  for (const url of LEGI_INDEX_URLS) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (res.ok) {
        const idx = await res.json() as Array<{ id: string }>;
        return idx.map((c) => c.id).filter(Boolean);
      }
      lastErr = new Error(`${url} HTTP ${res.status}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error("legi-data index: all sources failed");
}

interface SectionNode {
  id?: string;
  title?: string;
  articles?: Array<{ id: string; num?: string; etat?: string }>;
  sections?: SectionNode[];
}

interface BatchItem {
  code_id: string;
  code_title: string;
  article_id: string;
  num: string | null;
  section_path: string[];
}

function flattenCode(codeId: string, codeTitle: string, root: { sections?: SectionNode[]; articles?: SectionNode["articles"] }): BatchItem[] {
  const out: BatchItem[] = [];
  const walk = (sections: SectionNode[] | undefined, path: string[]) => {
    if (!sections) return;
    for (const s of sections) {
      const np = s.title ? [...path, s.title] : path;
      if (s.articles) {
        for (const a of s.articles) {
          if (a.etat && a.etat !== "VIGUEUR" && a.etat !== "VIGUEUR_ETEN") continue;
          out.push({ code_id: codeId, code_title: codeTitle, article_id: a.id, num: a.num ?? null, section_path: np });
        }
      }
      if (s.sections) walk(s.sections, np);
    }
  };
  walk(root.sections, []);
  if (root.articles) {
    for (const a of root.articles) {
      if (a.etat && a.etat !== "VIGUEUR" && a.etat !== "VIGUEUR_ETEN") continue;
      out.push({ code_id: codeId, code_title: codeTitle, article_id: a.id, num: a.num ?? null, section_path: [] });
    }
  }
  return out;
}

async function runIngestion(
  db: ReturnType<typeof getAdminClient>,
  apiKey: string,
  body: { resume_batch_id?: string; mode?: string; codes?: string[] },
): Promise<void> {
  let batchId: string;
  if (body.resume_batch_id) {
    batchId = String(body.resume_batch_id);
  } else {
    const codes: string[] = body.mode === "all"
      ? await fetchAllCodes()
      : (Array.isArray(body.codes) && body.codes.length ? body.codes : DEFAULT_CODES);
    const items: BatchItem[] = [];
    const failedCodes: string[] = [];
    const CONCURRENCY = 4;
    for (let i = 0; i < codes.length; i += CONCURRENCY) {
      const batch = codes.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (codeId) => {
          const tree = await legifranceFetch<{ sections?: SectionNode[]; articles?: SectionNode["articles"]; title?: string }>(
            "/consult/code/tableMatieres",
            { textId: codeId, date: Date.now(), sctId: "" },
          );
          const codeTitle = tree.title ?? KNOWN_CODES[codeId] ?? codeId;
          return flattenCode(codeId, codeTitle, tree);
        }),
      );
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") items.push(...r.value);
        else { failedCodes.push(batch[idx]); console.warn(`[legifrance-full] code ${batch[idx]} skipped: ${r.reason}`); }
      });
    }
    batchId = await startBatch(db, "legifrance-full", "code-articles", items, { codes, failed_codes: failedCodes });
    console.log(`[legifrance-full] batch ${batchId} planned: ${items.length} articles, ${failedCodes.length} codes failed`);
  }

  const start = Date.now();
  let totalIngested = 0, totalSkipped = 0, totalFailed = 0;

  // Un article par itération + commit immédiat → progression visible et batch
  // toujours reprenable même si le runtime nous coupe au prochain tour.
  while (Date.now() - start < TIME_BUDGET_MS) {
    const items = await getNextItems<BatchItem>(db, batchId, 1);
    if (items.length === 0) break;
    await heartbeat(db, batchId);
    const it = items[0];

    let ing = 0, skip = 0, failed = false;
    try {
      const art = await legifranceFetch<{ article?: { id: string; num?: string; texte?: string; texteHtml?: string; dateDebut?: number; etat?: string; cid?: string } }>(
        "/consult/getArticle", { id: it.article_id },
      );
      const raw = art.article?.texte ?? art.article?.texteHtml ?? "";
      const text = stripHtml(raw);
      if (!text || text.length < 30) {
        await markProcessed(db, batchId, [it], 0, 0);
        await new Promise((r) => setTimeout(r, 80));
        continue;
      }

      const locline = it.section_path.length ? `**Localisation** : ${it.code_title} > ${it.section_path.join(" > ")}\n\n` : `**Localisation** : ${it.code_title}\n\n`;
      const content = `${locline}# Article ${it.num ?? art.article?.num ?? it.article_id}\n\n${text}`;
      const hash = await sha256(content);
      const dec = await shouldIngest(db, "legifrance", it.article_id, hash);
      if (!dec.shouldIngest) { skip = 1; }
      else {
        await ingestSource(db, apiKey, "legifrance", {
          external_id: it.article_id,
          source_type: "code_article",
          title: `${it.code_title} — Article ${it.num ?? art.article?.num ?? it.article_id}`,
          content,
          reference_code: `Article ${it.num ?? art.article?.num}`,
          official_url: `https://www.legifrance.gouv.fr/codes/article_lc/${it.article_id}`,
          legal_date: art.article?.dateDebut ? new Date(art.article.dateDebut).toISOString().slice(0, 10) : null,
          raw_metadata: { code_id: it.code_id, cid: art.article?.cid, etat: art.article?.etat, section_path: it.section_path, content_hash: hash },
        });
        ing = 1;
      }
    } catch (err) {
      failed = true;
      console.error(`[legifrance-full] ${it.article_id}:`, (err as Error).message);
    }

    if (failed) { await markFailed(db, batchId, [it], "see logs"); totalFailed++; }
    else { await markProcessed(db, batchId, [it], ing, skip); totalIngested += ing; totalSkipped += skip; }
    await new Promise((r) => setTimeout(r, 80));
  }

  const fin = await finalizeBatch(db, batchId);
  console.log(`[legifrance-full] tick done batch=${batchId} status=${fin.status} ingested=${totalIngested} skipped=${totalSkipped} failed=${totalFailed} processed=${fin.processed}/${fin.total}`);

  // Auto-relance interne si batch en pause (même pattern que KALI).
  if (fin.status === "paused") {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const supaUrl = Deno.env.get("SUPABASE_URL");
    const srvKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (cronSecret && supaUrl && srvKey) {
      try {
        await fetch(`${supaUrl}/functions/v1/connector-legifrance-full`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-cron": cronSecret,
            "Authorization": `Bearer ${srvKey}`,
          },
          body: JSON.stringify({ resume_batch_id: batchId }),
        });
        console.log(`[legifrance-full] auto-resume scheduled for batch ${batchId}`);
      } catch (e) {
        console.warn(`[legifrance-full] auto-resume failed:`, (e as Error).message);
      }
    }
  }
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Auto-relance interne (chaînage de ticks) : secret partagé au lieu d'un JWT super_admin.
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

    // Dry-run: planning rapide, pas d'ingestion
    if (dryRun) {
      const codes: string[] = body.mode === "all"
        ? await fetchAllCodes()
        : (Array.isArray(body.codes) && body.codes.length ? body.codes : DEFAULT_CODES);
      const items: BatchItem[] = [];
      const failedCodes: string[] = [];
      const CONCURRENCY = 4;
      for (let i = 0; i < codes.length; i += CONCURRENCY) {
        const batch = codes.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(async (codeId) => {
          const tree = await legifranceFetch<{ sections?: SectionNode[]; articles?: SectionNode["articles"]; title?: string }>(
            "/consult/code/tableMatieres", { textId: codeId, date: Date.now(), sctId: "" },
          );
          return flattenCode(codeId, tree.title ?? KNOWN_CODES[codeId] ?? codeId, tree);
        }));
        results.forEach((r, idx) => {
          if (r.status === "fulfilled") items.push(...r.value);
          else failedCodes.push(batch[idx]);
        });
      }
      return json({ dry_run: true, codes_count: codes.length, articles_total: items.length, failed_codes: failedCodes, sample: items.slice(0, 5) });
    }

    // Lancement asynchrone : on rend la main immédiatement, le travail
    // (planning + ingestion) tourne en tâche de fond via waitUntil.
    // @ts-ignore EdgeRuntime is provided by Supabase Edge runtime
    EdgeRuntime.waitUntil(
      runIngestion(db, apiKey, body).catch((err) => {
        console.error("[legifrance-full] background error:", (err as Error).message);
      }),
    );
    return json({
      status: "started",
      message: "Ingestion lancée en arrière-plan. Le batch apparaîtra dans Jobs récents sous ~30s (le temps de planifier les articles).",
      resume_batch_id: body.resume_batch_id ?? null,
    }, 202);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
