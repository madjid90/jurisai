// Pré-remplissage automatique d'une session de génération.
// Sources : dossier (cas, client lié, salarié), OCR (analyse de document), historique.
// N'écrase JAMAIS une valeur déjà fournie par l'utilisateur.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { PrefillSource, TemplateField } from "@/lib/templates/template-config";

const db = supabaseAdmin as unknown as { from: (t: string) => any };

export type PrefillContext = {
  tenantId: string;
  dossierId?: string | null;
  uploadedAnalysisId?: string | null;
  enabledSources: PrefillSource[];
};

export type PrefillResult = {
  data: Record<string, unknown>;
  metadata: Record<string, { source: PrefillSource; confidence?: number; raw?: string }>;
  uncertain: Array<{ key: string; reason: string }>;
};

const FIELD_HINTS: Record<string, string[]> = {
  client_name: ["client.name", "client.legal_name"],
  client_legal_name: ["client.legal_name", "client.name"],
  client_email: ["client.email"],
  client_address: ["client.address"],
  client_siret: ["client.siret"],
  case_title: ["dossier.title"],
  case_description: ["dossier.description"],
  case_category: ["dossier.category"],
};

function pickPath(obj: any, path: string): unknown {
  return path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

export async function prefillSession(
  fields: TemplateField[],
  ctx: PrefillContext,
): Promise<PrefillResult> {
  const result: PrefillResult = { data: {}, metadata: {}, uncertain: [] };
  if (fields.length === 0) return result;

  // Charge le contexte
  let dossier: any = null;
  let client: any = null;
  let analysis: any = null;
  let extracted: Array<{ field_key: string; field_value: string | null; confidence: number | null }> = [];

  if (ctx.dossierId && (ctx.enabledSources.includes("dossier") || ctx.enabledSources.includes("client"))) {
    const { data: d } = await db
      .from("dossiers")
      .select("id, title, description, category, status, client_id")
      .eq("id", ctx.dossierId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    dossier = d;
    if (dossier?.client_id && ctx.enabledSources.includes("client")) {
      const { data: c } = await db
        .from("clients")
        .select("*")
        .eq("id", dossier.client_id)
        .eq("tenant_id", ctx.tenantId)
        .maybeSingle();
      client = c;
    }
  }

  if (ctx.uploadedAnalysisId && ctx.enabledSources.includes("ocr")) {
    const { data: a } = await db
      .from("document_analyses")
      .select("id, summary, key_points, structured_data")
      .eq("id", ctx.uploadedAnalysisId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    analysis = a;
    const { data: ef } = await db
      .from("extracted_fields")
      .select("field_key, field_value, confidence")
      .eq("document_analysis_id", ctx.uploadedAnalysisId)
      .eq("tenant_id", ctx.tenantId);
    extracted = ef ?? [];
  }

  const root = { dossier, client, analysis };

  for (const f of fields) {
    // 1) OCR : champ extrait avec confidence
    if (ctx.enabledSources.includes("ocr") && extracted.length) {
      const hit = extracted.find((e) => e.field_key === f.key);
      if (hit?.field_value) {
        result.data[f.key] = hit.field_value;
        result.metadata[f.key] = { source: "ocr", confidence: hit.confidence ?? undefined };
        if ((hit.confidence ?? 1) < 0.7) {
          result.uncertain.push({ key: f.key, reason: `Confiance OCR ${Math.round((hit.confidence ?? 0) * 100)}%` });
        }
        continue;
      }
    }

    // 2) Mapping connu via FIELD_HINTS
    const hints = FIELD_HINTS[f.key] ?? [];
    for (const path of hints) {
      const v = pickPath(root, path);
      if (v != null && v !== "") {
        const source: PrefillSource = path.startsWith("client.") ? "client" : "dossier";
        if (!ctx.enabledSources.includes(source)) continue;
        result.data[f.key] = String(v);
        result.metadata[f.key] = { source };
        break;
      }
    }
  }

  return result;
}
