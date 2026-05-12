// connector-retry-empty — Re-ingère les legal_sources qui n'ont AUCUN chunk.
//
// Cible les sources "orphelines" (existent dans legal_sources mais aucune ligne
// dans legal_chunks) pour un connecteur donné. Pour chaque source :
//  1. Re-fetch le contenu depuis l'API officielle
//  2. Si contenu suffisant → ré-ingestion normale (staging→promote, hash bypassé)
//  3. Si toujours trop court → suppression de la legal_source vide (catalog cleanup)
//
// Connecteurs supportés : bofip, judilibre, cdtn-fiches, legifrance.
// (kali nécessite un walk d'arbre depuis la convention parente — non couvert ici.)
//
// POST body: { connector: "bofip"|"judilibre"|"cdtn-fiches"|"legifrance",
//              max_items?: number, dry_run?: boolean, resume_batch_id?: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256 } from "../_shared/content-hash.ts";
import { legifranceFetch } from "../_shared/piste.ts";
import { stripHtml } from "../_shared/unist-extract.ts";

const TIME_BUDGET_MS = 60_000;
const BOFIP_API = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/bofip-vigueur";
const JUDILIBRE_BASE = () => Deno.env.get("PISTE_SANDBOX") === "1"
  ? "https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0"
  : "https://api.piste.gouv.fr/cassation/judilibre/v1.0";

type Connector = "bofip" | "judilibre" | "cdtn-fiches" | "legifrance";

interface RetryItem {
  source_id: string;
  external_id: string;
  official_url?: string | null;
  raw_metadata?: Record<string, unknown> | null;
}

function getJudilibreKey(): string {
  const k = Deno.env.get("PISTE_API_KEY") ?? Deno.env.get("JUDILIBRE_KEY_ID");
  if (!k) throw new Error("PISTE_API_KEY manquant");
  return k;
}

// ============================================================
// Re-fetchers — retournent { content, title?, legal_date?, source_type } | null
// ============================================================

async function refetchBofip(it: RetryItem): Promise<{ content: string; title: string; legal_date: string | null; source_type: string; reference_code: string; raw: Record<string, unknown> } | null> {
  const where = `identifiant_juridique="${it.external_id.replace(/"/g, '\\"')}"`;
  const url = `${BOFIP_API}/records?${new URLSearchParams({ select: "contenu,titre,debut_de_validite,permalien,serie,division", where, limit: "1", offset: "0" }).toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`bofip ${res.status}`);
  const data = await res.json() as { results?: Array<{ contenu?: string; titre?: string; debut_de_validite?: string; permalien?: string; serie?: string; division?: string }> };
  const rec = data.results?.[0];
  const text = (rec?.contenu ?? "").trim();
  if (!text || text.length < 80) return null;
  const title = rec?.titre ?? `BOFiP ${it.external_id}`;
  const loc = [rec?.serie, rec?.division].filter(Boolean).join(" / ");
  return {
    content: `**BOFiP** · ${loc}\n\n# ${title}\n\n${text}`,
    title: `BOFiP — ${title}`,
    legal_date: rec?.debut_de_validite ?? null,
    source_type: "doctrine_fiscale",
    reference_code: it.external_id,
    raw: { bofip_id: it.external_id, serie: rec?.serie, division: rec?.division },
  };
}

async function refetchJudilibre(it: RetryItem): Promise<{ content: string; title: string; legal_date: string | null; source_type: string; reference_code: string | null; raw: Record<string, unknown> } | null> {
  const key = getJudilibreKey();
  const res = await fetch(`${JUDILIBRE_BASE()}/decision?id=${encodeURIComponent(it.external_id)}`, { headers: { KeyId: key, apikey: key, Accept: "application/json" } });
  if (!res.ok) throw new Error(`judilibre ${res.status}`);
  const d = await res.json() as { id: string; chamber?: string; formation?: string; decision_date?: string; number?: string; solution?: string; summary?: string; text?: string; themes?: string[] };
  const text = (d.text ?? d.summary ?? "").trim();
  if (!text || text.length < 100) return null;
  return {
    content: `**Cour de cassation** · ${d.chamber ?? ""} · ${d.decision_date ?? ""}\n\n# Décision ${d.number ?? d.id}\n\n${text}`,
    title: `Cass. ${d.chamber ?? ""} ${d.decision_date ?? ""} — ${d.number ?? d.id}`.trim(),
    legal_date: d.decision_date ?? null,
    source_type: "jurisprudence",
    reference_code: d.number ?? null,
    raw: { chamber: d.chamber, formation: d.formation, solution: d.solution, themes: d.themes },
  };
}

async function refetchCdtnFiche(it: RetryItem): Promise<{ content: string; title: string; legal_date: string | null; source_type: string; reference_code: string | null; raw: Record<string, unknown>; official_url: string } | null> {
  // external_id format: "fiche-service-public/<slug>" ou "fiche-ministere-travail/<slug>"
  const parts = it.external_id.split("/");
  if (parts.length !== 2) return null;
  const url = it.official_url ?? `https://code.travail.gouv.fr/${it.external_id}`;
  const r = await fetch(url, { headers: { "user-agent": "JurisAI-bot/1.0" } });
  if (!r.ok) throw new Error(`cdtn ${r.status}`);
  const html = await r.text();
  const titleM = html.match(/<title>([^<]+)<\/title>/);
  const title = (titleM?.[1] ?? parts[1]).replace(/\s*-\s*Code du travail numérique\s*$/, "").trim();
  const mainM = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  let body = mainM ? mainM[1] : html;
  body = body
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<nav[\s\S]*?<\/nav>/g, "")
    .replace(/<h([1-6])[^>]*>/g, (_, n) => "\n" + "#".repeat(parseInt(n, 10)) + " ")
    .replace(/<\/h[1-6]>/g, "\n")
    .replace(/<li[^>]*>/g, "\n- ")
    .replace(/<\/p>|<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (body.length < 200) return null;
  const sourceLabel = parts[0] === "fiche-service-public" ? "Service-Public.fr" : "Ministère du Travail";
  return {
    content: `**Source officielle** : ${sourceLabel}\n**URL** : ${url}\n\n# ${title}\n\n${body}`,
    title,
    legal_date: null,
    source_type: parts[0] === "fiche-service-public" ? "fiche_service_public" : "fiche_ministere_travail",
    reference_code: null,
    raw: { slug: it.external_id, source: parts[0] === "fiche-service-public" ? "fiches-service-public" : "fiches-ministere-travail" },
    official_url: url,
  };
}

async function refetchLegifranceArticle(it: RetryItem): Promise<{ content: string; title: string; legal_date: string | null; source_type: string; reference_code: string | null; raw: Record<string, unknown> } | null> {
  // external_id ressemble à "LEGIARTI000006...". On utilise PISTE getArticle.
  const data = await legifranceFetch("/consult/getArticle", { id: it.external_id }) as { article?: { id?: string; num?: string; texte?: string; texteHtml?: string; dateDebut?: number; cid?: string } };
  const art = data.article;
  if (!art) return null;
  const text = stripHtml(art.texteHtml ?? art.texte ?? "").trim();
  if (!text || text.length < 80) return null;
  const date = art.dateDebut ? new Date(art.dateDebut).toISOString().slice(0, 10) : null;
  return {
    content: `**Légifrance** · Article ${art.num ?? ""}\n\n${text}`,
    title: `Article ${art.num ?? art.id}`,
    legal_date: date,
    source_type: "code_article",
    reference_code: art.num ?? null,
    raw: { article_id: art.id, cid: art.cid, num: art.num },
  };
}

async function refetch(connector: Connector, it: RetryItem) {
  switch (connector) {
    case "bofip": return refetchBofip(it);
    case "judilibre": return refetchJudilibre(it);
    case "cdtn-fiches": return refetchCdtnFiche(it);
    case "legifrance": return refetchLegifranceArticle(it);
  }
}

// ============================================================

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const internalToken = req.headers.get("x-internal-cron");
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isInternal = !!internalToken && !!cronSecret && internalToken === cronSecret;
    if (!isInternal) await requireSuperAdmin(req);

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const db = getAdminClient();
    const apiKey = getLovableApiKey();

    const connector = String(body.connector ?? "") as Connector;
    if (!["bofip", "judilibre", "cdtn-fiches", "legifrance"].includes(connector)) {
      return json({ error: "connector requis : bofip | judilibre | cdtn-fiches | legifrance" }, 400);
    }

    let batchId: string;
    let needsPlanning = false;
    const max = Number.isFinite(Number(body.max_items)) && Number(body.max_items) > 0 ? Number(body.max_items) : Number.POSITIVE_INFINITY;

    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      // Planning : liste des sources sans chunks pour ce connecteur
      const { data: empties, error: empErr } = await db.rpc("list_empty_sources", { p_connector: connector });
      if (empErr) {
        // RPC absente → fallback SQL direct
        const { data: rows, error } = await db
          .from("legal_sources")
          .select("id, external_id, official_url, raw_metadata")
          .eq("connector", connector)
          .limit(5000);
        if (error) throw error;
        // Filtre côté JS : sources sans chunks
        const ids = (rows ?? []).map((r) => r.id as string);
        if (ids.length === 0) return json({ status: "noop", message: "Aucune source pour ce connecteur." });
        const { data: chunkSources } = await db.from("legal_chunks").select("source_id").in("source_id", ids);
        const withChunks = new Set((chunkSources ?? []).map((c) => c.source_id as string));
        const items: RetryItem[] = (rows ?? [])
          .filter((r) => !withChunks.has(r.id as string))
          .slice(0, Number.isFinite(max) ? max : undefined)
          .map((r) => ({
            source_id: r.id as string,
            external_id: r.external_id as string,
            official_url: r.official_url as string | null,
            raw_metadata: r.raw_metadata as Record<string, unknown> | null,
          }));
        if (dryRun) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
        if (items.length === 0) return json({ status: "noop", message: "Aucune source vide pour ce connecteur." });
        batchId = await startBatch(db, `retry-empty-${connector}`, "empty-sources", items, { connector });
      } else {
        const items: RetryItem[] = (empties ?? []).slice(0, Number.isFinite(max) ? max : undefined);
        if (dryRun) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
        if (items.length === 0) return json({ status: "noop", message: "Aucune source vide pour ce connecteur." });
        batchId = await startBatch(db, `retry-empty-${connector}`, "empty-sources", items, { connector });
      }
    }

    // @ts-ignore EdgeRuntime injecté par Supabase
    EdgeRuntime.waitUntil((async () => {
      try {
        const start = Date.now();
        let reingested = 0, deleted = 0, failed = 0;

        while (Date.now() - start < TIME_BUDGET_MS) {
          const items = await getNextItems<RetryItem>(db, batchId, 1);
          if (!items.length) break;
          await heartbeat(db, batchId);
          const it = items[0];
          try {
            const fetched = await refetch(connector, it);
            if (!fetched) {
              // Contenu toujours vide/insuffisant → suppression de la source vide
              await db.from("legal_sources").delete().eq("id", it.source_id);
              deleted++;
              await markProcessed(db, batchId, [it], 0, 1);
            } else {
              const content = fetched.content;
              const hash = await sha256(content);
              // Bypass shouldIngest : on supprime la source vide puis on ré-ingère à neuf
              await db.from("legal_sources").delete().eq("id", it.source_id);
              await ingestSource(db, apiKey, connector === "cdtn-fiches" ? "cdtn-fiches" : connector === "bofip" ? "bofip" : connector === "judilibre" ? "judilibre" : "legifrance", {
                external_id: it.external_id,
                source_type: fetched.source_type,
                title: fetched.title,
                content,
                reference_code: fetched.reference_code ?? null,
                official_url: ("official_url" in fetched ? fetched.official_url : it.official_url) ?? null,
                legal_date: fetched.legal_date,
                raw_metadata: { ...fetched.raw, content_hash: hash, retried_from_empty: true },
              });
              reingested++;
              await markProcessed(db, batchId, [it], 1, 0);
            }
          } catch (err) {
            failed++;
            await markFailed(db, batchId, [it], (err as Error).message);
            console.error(`[retry-empty/${connector}] ${it.external_id}:`, (err as Error).message);
          }
          await new Promise((r) => setTimeout(r, 80));
        }

        const fin = await finalizeBatch(db, batchId);
        console.log(`[connector-retry-empty/${connector}] batch=${batchId} status=${fin.status} reingested=${reingested} deleted=${deleted} failed=${failed}`);

        if (fin.status === "paused") {
          const cs = Deno.env.get("CRON_SECRET");
          const su = Deno.env.get("SUPABASE_URL");
          const srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (cs && su && srv) {
            try {
              await fetch(`${su}/functions/v1/connector-retry-empty`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-internal-cron": cs, "Authorization": `Bearer ${srv}` },
                body: JSON.stringify({ connector, resume_batch_id: batchId }),
              });
            } catch (e) {
              console.warn(`[retry-empty] auto-resume failed:`, (e as Error).message);
            }
          }
        }
      } catch (err) {
        console.error(`[connector-retry-empty] background error:`, (err as Error).message);
      }
    })());

    return json({
      status: "started",
      message: `Retry sources vides ${connector} lancé. Suivi dans Jobs récents.`,
      batch_id: batchId,
    }, 202);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
  }
});
