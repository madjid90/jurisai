// Connector: Légifrance via PISTE API (OAuth2).
// MVP scope: ingest a single code, e.g. "Code du travail" (LEGITEXT000006072050).
//
// POST body: { code_id?: string, max_articles?: number, dry_run?: boolean }
// Default code_id = LEGITEXT000006072050 (Code du travail).
//
// Requires secrets: LEGIFRANCE_OAUTH_ID, LEGIFRANCE_OAUTH_SECRET.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeadersFor,
  finishJob,
  getAdminClient,
  getLovableApiKey,
  ingestSource,
  logError,
  startJob,
  updateJob,
} from "../_shared/ingest.ts";
import { legifranceFetch } from "../_shared/piste.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";

const DEFAULT_CODE = "LEGITEXT000006072050"; // Code du travail

// Common code IDs (helpers for UI)
export const KNOWN_CODES: Record<string, string> = {
  "Code du travail": "LEGITEXT000006072050",
  "Code de la sécurité sociale": "LEGITEXT000006073189",
  "Code de commerce": "LEGITEXT000005634379",
  "Code civil": "LEGITEXT000006070721",
  "Code général des impôts": "LEGITEXT000006069577",
  "Code de la consommation": "LEGITEXT000006069565",
};

interface CodeTreeSection {
  id?: string;
  title?: string;
  articles?: Array<{ id: string; num?: string; etat?: string }>;
  sections?: CodeTreeSection[];
}

interface CodeResponse {
  sections?: CodeTreeSection[];
  articles?: Array<{ id: string; num?: string; etat?: string }>;
  title?: string;
}

interface ArticleResponse {
  article?: {
    id: string;
    num?: string;
    texte?: string;
    texteHtml?: string;
    dateDebut?: number;
    etat?: string;
    cid?: string;
  };
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({}));
    const codeId: string = body.code_id ?? DEFAULT_CODE;
    const maxArticles: number = Math.min(Number(body.max_articles) || 5000, 10000);
    const dryRun: boolean = body.dry_run === true;

    const db = getAdminClient();
    const apiKey = getLovableApiKey();
    const jobId = await startJob(db, "legifrance", { code_id: codeId, max_articles: maxArticles });

    // 1. Fetch the code structure
    let codeData: CodeResponse;
    try {
      codeData = await legifranceFetch<CodeResponse>("/consult/code", {
        textId: codeId,
        date: new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      await logError(db, jobId, "legifrance", codeId, "auth_or_api_error",
        (err as Error).message);
      await finishJob(db, jobId, "failed");
      return jsonResponse({
        error: (err as Error).message,
        hint: "Vérifiez que LEGIFRANCE_OAUTH_ID et LEGIFRANCE_OAUTH_SECRET sont configurés " +
          "dans les secrets Supabase et que l'API Légifrance est souscrite sur PISTE.",
      }, 500);
    }

    // 2. Walk tree to collect article ids
    const articleIds: Array<{ id: string; num?: string }> = [];
    const walk = (sections: CodeTreeSection[] | undefined) => {
      if (!sections) return;
      for (const s of sections) {
        if (s.articles) {
          for (const a of s.articles) {
            if (a.etat === "VIGUEUR" || !a.etat) {
              articleIds.push({ id: a.id, num: a.num });
            }
          }
        }
        if (s.sections) walk(s.sections);
      }
    };
    walk(codeData.sections);
    if (codeData.articles) {
      for (const a of codeData.articles) {
        if (a.etat === "VIGUEUR" || !a.etat) {
          articleIds.push({ id: a.id, num: a.num });
        }
      }
    }

    const target = articleIds.slice(0, maxArticles);
    await updateJob(db, jobId, { items_total: target.length });

    if (dryRun) {
      await finishJob(db, jobId, "completed", { items_processed: 0 });
      return jsonResponse({
        job_id: jobId,
        dry_run: true,
        code_title: codeData.title,
        articles_found: articleIds.length,
        articles_to_ingest: target.length,
      });
    }

    // 3. Fetch + ingest each article (rate-limit gentle: ~10 req/s)
    let processed = 0;
    let failed = 0;
    for (const a of target) {
      try {
        const art = await legifranceFetch<ArticleResponse>("/consult/getArticle", { id: a.id });
        const text = (art.article?.texte ?? art.article?.texteHtml ?? "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!text) continue;

        await ingestSource(db, apiKey, "legifrance", {
          external_id: a.id,
          source_type: "code_article",
          title: `${codeData.title ?? "Code"} — Article ${a.num ?? art.article?.num ?? a.id}`,
          content: text,
          reference_code: `Article ${a.num ?? art.article?.num}`,
          official_url: `https://www.legifrance.gouv.fr/codes/article_lc/${a.id}`,
          legal_date: art.article?.dateDebut
            ? new Date(art.article.dateDebut).toISOString().slice(0, 10)
            : null,
          raw_metadata: { code_id: codeId, cid: art.article?.cid, etat: art.article?.etat },
        });
        processed++;
        if (processed % 25 === 0) {
          await updateJob(db, jobId, { items_processed: processed });
        }
      } catch (err) {
        failed++;
        await logError(db, jobId, "legifrance", a.id, "article_ingest_error",
          (err as Error).message);
      }
      // light delay
      await new Promise((r) => setTimeout(r, 100));
    }

    await finishJob(db, jobId, "completed", {
      items_processed: processed,
      items_failed: failed,
    });
    return jsonResponse({ job_id: jobId, processed, failed, total: target.length });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
