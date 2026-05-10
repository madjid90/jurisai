// connector-legifrance-full — Codes Légifrance via PISTE, version COMPLÈTE.
// 1 row par article (avec section_path), SHA-256 incrémental, batch resumable.
//
// POST body: { codes?: string[], resume_batch_id?: string, dry_run?: boolean }
// codes par défaut: ["LEGITEXT000006072050"] (Code du travail).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { legifranceFetch } from "../_shared/piste.ts";
import { finalizeBatch, getNextItems, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";
import { stripHtml } from "../_shared/unist-extract.ts";

const TIME_BUDGET_MS = 135_000;
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

const LEGI_INDEX_URL = "https://unpkg.com/@socialgouv/legi-data/data/index.json";
async function fetchAllCodes(): Promise<string[]> {
  const res = await fetch(LEGI_INDEX_URL);
  if (!res.ok) throw new Error(`legi-data index HTTP ${res.status}`);
  const idx = await res.json() as Array<{ id: string }>;
  return idx.map((c) => c.id).filter(Boolean);
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
      const codes: string[] = body.mode === "all"
        ? await fetchAllCodes()
        : (Array.isArray(body.codes) && body.codes.length ? body.codes : DEFAULT_CODES);
      const items: BatchItem[] = [];
      for (const codeId of codes) {
        const tree = await legifranceFetch<{ sections?: SectionNode[]; articles?: SectionNode["articles"]; title?: string }>(
          "/consult/code/tableMatieres",
          { textId: codeId, date: Date.now(), sctId: "" },
        );
        const codeTitle = tree.title ?? KNOWN_CODES[codeId] ?? codeId;
        items.push(...flattenCode(codeId, codeTitle, tree));
      }
      if (dryRun) return json({ dry_run: true, codes, articles_total: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "legifrance-full", "code-articles", items, { codes });
    }

    const start = Date.now();
    let totalIngested = 0, totalSkipped = 0, totalFailed = 0;

    while (Date.now() - start < TIME_BUDGET_MS) {
      const items = await getNextItems<BatchItem>(db, batchId, 20);
      if (items.length === 0) break;
      const ok: BatchItem[] = [], failed: BatchItem[] = [];
      let ing = 0, skip = 0;

      for (const it of items) {
        if (Date.now() - start > TIME_BUDGET_MS) break;
        try {
          const art = await legifranceFetch<{ article?: { id: string; num?: string; texte?: string; texteHtml?: string; dateDebut?: number; etat?: string; cid?: string } }>(
            "/consult/getArticle", { id: it.article_id },
          );
          const raw = art.article?.texte ?? art.article?.texteHtml ?? "";
          const text = stripHtml(raw);
          if (!text || text.length < 30) { ok.push(it); continue; }

          const locline = it.section_path.length ? `**Localisation** : ${it.code_title} > ${it.section_path.join(" > ")}\n\n` : `**Localisation** : ${it.code_title}\n\n`;
          const content = `${locline}# Article ${it.num ?? art.article?.num ?? it.article_id}\n\n${text}`;
          const hash = await sha256(content);
          const dec = await shouldIngest(db, "legifrance", it.article_id, hash);
          if (!dec.shouldIngest) { skip++; ok.push(it); continue; }

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
          ing++; ok.push(it);
        } catch (err) {
          failed.push(it);
          console.error(`[legifrance-full] ${it.article_id}:`, (err as Error).message);
        }
        await new Promise((r) => setTimeout(r, 80));
      }

      if (ok.length) await markProcessed(db, batchId, ok, ing, skip);
      if (failed.length) await markFailed(db, batchId, failed, "see logs");
      totalIngested += ing; totalSkipped += skip; totalFailed += failed.length;
    }

    const fin = await finalizeBatch(db, batchId);
    return json({ batch_id: batchId, status: fin.status, processed: fin.processed, total: fin.total, ingested: totalIngested, skipped_unchanged: totalSkipped, failed: totalFailed });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
