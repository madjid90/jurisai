// Connector: SocialGouv/cdtn-admin → modèles de courriers RH.
// Pulls the GitHub directory listing, parses Markdown templates with YAML front-matter,
// extracts {{variables}}, inserts into templates_public.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  finishJob,
  getAdminClient,
  logError,
  startJob,
  updateJob,
} from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";

const GH_API_DIR =
  "https://api.github.com/repos/SocialGouv/cdtn-admin/contents/targets/frontend/data/modeles-de-courriers";
const GH_RAW_BASE =
  "https://raw.githubusercontent.com/SocialGouv/cdtn-admin/master/targets/frontend/data/modeles-de-courriers";

interface GhEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    await requireSuperAdmin(req);
    const db = getAdminClient();
    const jobId = await startJob(db, "cdtn-modeles", {});

    // 1. List directory
    const dirRes = await fetch(GH_API_DIR, {
      headers: { "User-Agent": "JurisAI-Bot/1.0", Accept: "application/vnd.github+json" },
    });
    if (!dirRes.ok) {
      // Fallback: directory might not exist exactly at that path; try alternate
      await finishJob(db, jobId, "failed");
      return jsonResponse({
        error: `cdtn-admin directory listing failed: ${dirRes.status}. ` +
          `Le chemin GitHub a peut-être changé — vérifier https://github.com/SocialGouv/cdtn-admin`,
      }, 502);
    }
    const entries: GhEntry[] = await dirRes.json();
    const mdFiles = entries.filter((e) => e.type === "file" && e.name.endsWith(".md"));

    await updateJob(db, jobId, { items_total: mdFiles.length });

    let processed = 0;
    let failed = 0;

    for (const f of mdFiles) {
      try {
        const url = f.download_url ?? `${GH_RAW_BASE}/${f.name}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
        const md = await res.text();

        const { frontMatter, body } = parseFrontMatter(md);
        const title = (frontMatter.title as string) ?? f.name.replace(/\.md$/, "");
        const description = (frontMatter.description as string) ?? null;
        const variables = extractVariables(body);

        await db.from("templates_public").upsert({
          external_id: f.path,
          category: "rh",
          title,
          description,
          content_md: body,
          variables,
          legal_basis: (frontMatter.references as string[]) ?? [],
          disclaimer:
            "Modèle public issu de SocialGouv/cdtn-admin (Apache 2.0). " +
            "À adapter à votre situation et à faire valider par un juriste si nécessaire.",
          quality_level: "public_unverified",
          source_url: `https://github.com/SocialGouv/cdtn-admin/blob/master/${f.path}`,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: "external_id" });

        processed++;
        await updateJob(db, jobId, { items_processed: processed });
      } catch (err) {
        failed++;
        await logError(db, jobId, "cdtn-modeles", f.path, "ingest_error",
          (err as Error).message);
      }
    }

    await finishJob(db, jobId, "completed", {
      items_processed: processed,
      items_failed: failed,
    });

    return jsonResponse({ job_id: jobId, processed, failed, total: mdFiles.length });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

function parseFrontMatter(md: string): {
  frontMatter: Record<string, unknown>;
  body: string;
} {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontMatter: {}, body: md };
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) {
      const v = kv[2].trim();
      if (v.startsWith("[") && v.endsWith("]")) {
        fm[kv[1]] = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      } else {
        fm[kv[1]] = v.replace(/^["']|["']$/g, "");
      }
    }
  }
  return { frontMatter: fm, body: m[2] };
}

function extractVariables(body: string): Array<{ name: string; label: string }> {
  const set = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(body)) !== null) set.add(m[1]);
  return [...set].map((name) => ({
    name,
    label: name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  }));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
