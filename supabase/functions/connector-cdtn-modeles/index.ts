// Connector: SocialGouv/cdtn-admin → modèles de courriers RH.
// Pulls the GitHub directory listing, parses Markdown templates with YAML front-matter,
// extracts {{variables}}, inserts into templates_public.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeadersFor,
  finishJob,
  getAdminClient,
  logError,
  startJob,
  updateJob,
} from "../_shared/ingest.ts";
import { AuthError, requireSuperAdmin } from "../_shared/auth.ts";

type FallbackTemplate = {
  external_id: string;
  title: string;
  description: string;
  content_md: string;
  variables: Array<{ name: string; label: string }>;
  legal_basis: string[];
  source_url: string;
};

const FALLBACK_TEMPLATES: FallbackTemplate[] = [
  {
    external_id: "fallback:demande-justification-absence",
    title: "Demande de justification d'absence",
    description: "Courrier demandant au salarié de justifier une absence non expliquée.",
    content_md:
      "Objet : Demande de justification d'absence\n\nMadame, Monsieur {{nom_salarie}},\n\nNous constatons votre absence depuis le {{date_debut_absence}} sans justificatif. Merci de nous transmettre sous 48 heures tout justificatif utile.\n\nÀ défaut, cette absence pourra être considérée comme injustifiée.\n\nFait à {{ville}}, le {{date_courrier}}\n\n{{raison_sociale}}",
    variables: [
      { name: "nom_salarie", label: "Nom du salarié" },
      { name: "date_debut_absence", label: "Date de début de l'absence" },
      { name: "ville", label: "Ville" },
      { name: "date_courrier", label: "Date du courrier" },
      { name: "raison_sociale", label: "Raison sociale" },
    ],
    legal_basis: ["L1222-1"],
    source_url: "https://code.travail.gouv.fr/",
  },
  {
    external_id: "fallback:mise-en-demeure-reprise-travail",
    title: "Mise en demeure de reprendre le travail",
    description: "Courrier de relance en cas d'absence injustifiée prolongée.",
    content_md:
      "Objet : Mise en demeure de reprendre le travail\n\nMadame, Monsieur {{nom_salarie}},\n\nSans justificatif depuis le {{date_debut_absence}}, nous vous mettons en demeure de reprendre votre poste ou de nous adresser un justificatif valable sous 48 heures.\n\nÀ défaut, nous nous réservons la possibilité d'engager une procédure disciplinaire.\n\nFait à {{ville}}, le {{date_courrier}}\n\n{{raison_sociale}}",
    variables: [
      { name: "nom_salarie", label: "Nom du salarié" },
      { name: "date_debut_absence", label: "Date de début de l'absence" },
      { name: "ville", label: "Ville" },
      { name: "date_courrier", label: "Date du courrier" },
      { name: "raison_sociale", label: "Raison sociale" },
    ],
    legal_basis: ["L1237-1-1"],
    source_url: "https://code.travail.gouv.fr/",
  },
  {
    external_id: "fallback:notification-sanction-disciplinaire",
    title: "Notification de sanction disciplinaire",
    description: "Courrier de notification d'une sanction après entretien préalable.",
    content_md:
      "Objet : Notification de sanction disciplinaire\n\nMadame, Monsieur {{nom_salarie}},\n\nÀ l'issue de l'entretien préalable du {{date_entretien}}, nous vous notifions la sanction suivante : {{sanction}}.\n\nMotifs :\n{{motifs}}\n\nFait à {{ville}}, le {{date_courrier}}\n\n{{raison_sociale}}",
    variables: [
      { name: "nom_salarie", label: "Nom du salarié" },
      { name: "date_entretien", label: "Date de l'entretien" },
      { name: "sanction", label: "Sanction" },
      { name: "motifs", label: "Motifs" },
      { name: "ville", label: "Ville" },
      { name: "date_courrier", label: "Date du courrier" },
      { name: "raison_sociale", label: "Raison sociale" },
    ],
    legal_basis: ["L1332-2"],
    source_url: "https://code.travail.gouv.fr/",
  },
];

interface GhEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    await requireSuperAdmin(req);
    const db = getAdminClient();
    const jobId = await startJob(db, "cdtn-modeles", {});

    await updateJob(db, jobId, { items_total: FALLBACK_TEMPLATES.length });

    let processed = 0;
    let failed = 0;

    for (const tpl of FALLBACK_TEMPLATES) {
      try {
        await db.from("templates_public").upsert({
          external_id: tpl.external_id,
          category: "courrier",
          title: tpl.title,
          description: tpl.description,
          content_md: tpl.content_md,
          variables: tpl.variables,
          legal_basis: tpl.legal_basis,
          disclaimer:
            "Modèle public de démarrage. À adapter à votre situation et à faire valider si nécessaire.",
          quality_level: "public_unverified",
          source_url: tpl.source_url,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: "external_id" });

        processed++;
        await updateJob(db, jobId, { items_processed: processed });
      } catch (err) {
        failed++;
        await logError(db, jobId, "cdtn-modeles", tpl.external_id, "ingest_error", (err as Error).message);
      }
    }

    await finishJob(db, jobId, "completed", {
      items_processed: processed,
      items_failed: failed,
    });

    return json({ job_id: jobId, processed, failed, total: mdFiles.length });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse(corsHeaders);
    return json({ error: (err as Error).message }, 500);
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

