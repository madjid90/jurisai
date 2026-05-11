// connector-cdtn-contributions-full — Q/R officielles CDTN depuis SocialGouv/contributions-data.
// Pas d'auth. Batch resumable. Index via GitHub contents API.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, getAdminClient, getLovableApiKey, ingestSource } from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";
import { finalizeBatch, getNextItems, heartbeat, markFailed, markProcessed, startBatch } from "../_shared/batch-state.ts";
import { sha256, shouldIngest } from "../_shared/content-hash.ts";

const TIME_BUDGET_MS = 60_000;
const GH_INDEX = "https://api.github.com/repos/SocialGouv/contributions-data/contents/data/contributions";
const RAW_BASE = "https://raw.githubusercontent.com/SocialGouv/contributions-data/master/data/contributions";

interface BatchItem { name: string; sha: string; download_url?: string; }

async function loadIndex(): Promise<BatchItem[]> {
  const r = await fetch(GH_INDEX, { headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "JurisAI/1.0" } });
  if (!r.ok) throw new Error(`GitHub index ${r.status}`);
  const arr = await r.json() as Array<{ type: string; name: string; sha: string; download_url?: string }>;
  return arr.filter((f) => f.type === "file" && f.name.endsWith(".json"))
    .map((f) => ({ name: f.name, sha: f.sha, download_url: f.download_url }));
}

interface Contribution {
  id?: string;
  title: string;
  index?: string;
  answers?: { generic?: { text?: string; markdown?: string; references?: unknown[] }; conventions?: Array<{ idcc?: string; markdown?: string }> };
  references?: unknown[];
}

function extractContent(c: Contribution): string {
  let out = `# ${c.title}\n\n`;
  if (c.answers?.generic?.markdown) out += `## Réponse générale\n\n${c.answers.generic.markdown}\n\n`;
  else if (c.answers?.generic?.text) out += `## Réponse générale\n\n${c.answers.generic.text}\n\n`;
  if (c.answers?.conventions?.length) {
    out += `## Réponses par convention collective\n\n`;
    for (const cc of c.answers.conventions.slice(0, 10)) {
      out += `### IDCC ${cc.idcc}\n${cc.markdown ?? ""}\n\n`;
    }
  }
  return out.replace(/\s+\n/g, "\n").trim();
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
    const body = await req.json().catch(() => ({})) as { dry_run?: boolean; resume_batch_id?: string };
    const db = getAdminClient();
    const apiKey = getLovableApiKey();

    let batchId: string;
    if (body.resume_batch_id) {
      batchId = String(body.resume_batch_id);
    } else {
      const items = await loadIndex();
      if (body.dry_run) return json({ dry_run: true, found: items.length, sample: items.slice(0, 5) });
      batchId = await startBatch(db, "cdtn-contributions-full", "contributions", items, {});
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
                const r = await fetch(it.download_url ?? `${RAW_BASE}/${it.name}`);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const c = await r.json() as Contribution;
                const content = extractContent(c);
                if (content.length < 100) { ok.push(it); continue; }

                const externalId = c.id ?? it.sha;
                const hash = await sha256(content);
                const dec = await shouldIngest(db, "cdtn-contributions-full", externalId, hash);
                if (!dec.shouldIngest) { sk++; ok.push(it); continue; }

                await ingestSource(db, apiKey, "cdtn-contributions", {
                  external_id: externalId,
                  source_type: "cdtn_question",
                  title: c.title.slice(0, 500),
                  content: `**Source officielle** : Code du travail numérique (DGT)\n\n${content}`,
                  reference_code: c.index ?? null,
                  official_url: `https://code.travail.gouv.fr/contribution/${c.id ?? externalId}`,
                  raw_metadata: {
                    cdtn_id: c.id, sha: it.sha, content_hash: hash,
                    cc_count: c.answers?.conventions?.length ?? 0,
                  },
                });
                ing++; ok.push(it);
              } catch (err) {
                fl.push(it);
                console.error(`[cdtn-contributions-full] ${it.name}:`, (err as Error).message);
              }
            }

            if (ok.length) await markProcessed(db, batchId, ok, ing, sk);
            if (fl.length) await markFailed(db, batchId, fl, "see logs");
            ingested += ing; skipped += sk; failed += fl.length;
          }

          const fin = await finalizeBatch(db, batchId);
          console.log(`[connector-cdtn-contributions-full] batch ${batchId} fini: status=${fin.status} processed=${fin.processed}/${fin.total} ingested=${ingested} skipped=${skipped} failed=${failed}`);

          if (fin.status === "paused") {
            const cs = Deno.env.get("CRON_SECRET");
            const su = Deno.env.get("SUPABASE_URL");
            if (cs && su) {
              try {
                await fetch(`${su}/functions/v1/connector-cdtn-contributions-full`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-internal-cron": cs,
                    "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
                  },
                  body: JSON.stringify({ resume_batch_id: batchId }),
                });
                console.log(`[connector-cdtn-contributions-full] auto-resume scheduled for batch ${batchId}`);
              } catch (e) {
                console.warn(`[connector-cdtn-contributions-full] auto-resume failed:`, (e as Error).message);
              }
            }
          }

      } catch (err) {

        console.error(`[connector-cdtn-contributions-full] background error:`, (err as Error).message);

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
