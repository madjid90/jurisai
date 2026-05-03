// findRelatedContext : à partir d'un document fraîchement OCRisé,
// retrouve les dossiers existants du tenant les plus pertinents.
//
// Signaux combinés :
//  1. Sémantique : embedding du résumé/texte → match_dossier_context (cosine)
//  2. Entités fortes : SIREN/SIRET/IBAN/email partagés avec d'autres documents
//     déjà liés à un dossier → forte présomption.
//  3. Dossier_ref textuelle ("dossier 2024-X") matchant un title/case_number.
//
// Score final ∈ [0,1]. Seuils décidés par l'appelant :
//   - >= 0.80 → liaison auto (status='confirmed', method='auto')
//   - 0.50–0.80 → suggestion (status='pending', method='suggested')
//   - < 0.50 → ignorer

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ExtractedEntity } from "./entity-extraction.server";
import { embedText, toPgVector } from "./embeddings.server";

export type DossierMatch = {
  dossierId: string;
  score: number;
  signals: {
    semantic?: number;
    sharedEntities?: string[];
    refMatch?: string;
  };
};

const STRONG_TYPES = new Set(["siren", "siret", "iban", "email", "dossier_ref"]);

export async function findRelatedContext(opts: {
  tenantId: string;
  text: string;
  entities: ExtractedEntity[];
  excludeDocumentId?: string;
  topK?: number;
}): Promise<DossierMatch[]> {
  const { tenantId, text, entities, excludeDocumentId, topK = 5 } = opts;
  const matches = new Map<string, DossierMatch>();

  // ---- 1) Signal sémantique
  const embedding = await embedText(text.slice(0, 4000));
  if (embedding) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabaseAdmin as any).rpc("match_dossier_context", {
      p_tenant_id: tenantId,
      p_embedding: toPgVector(embedding),
      p_match_count: topK,
      p_min_score: 0.65,
    });
    for (const row of (data ?? []) as Array<{
      dossier_id: string;
      best_score: number;
    }>) {
      const cur = matches.get(row.dossier_id) ?? {
        dossierId: row.dossier_id,
        score: 0,
        signals: {},
      };
      cur.signals.semantic = row.best_score;
      cur.score = Math.max(cur.score, row.best_score * 0.7);
      matches.set(row.dossier_id, cur);
    }
  }

  // ---- 2) Signal entités fortes (recherche dans entity_mentions liées à des dossiers)
  const strongEntities = entities.filter((e) => STRONG_TYPES.has(e.type));
  if (strongEntities.length) {
    const normalizedValues = strongEntities
      .map((e) => e.normalized ?? e.raw)
      .filter(Boolean);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mentions } = await (supabaseAdmin as any)
      .from("entity_mentions")
      .select("document_id, normalized_value, entity_type")
      .eq("tenant_id", tenantId)
      .in("normalized_value", normalizedValues);

    if (mentions?.length) {
      const docIds = Array.from(
        new Set(
          (mentions as Array<{ document_id: string }>)
            .map((m) => m.document_id)
            .filter((id) => id !== excludeDocumentId),
        ),
      );
      if (docIds.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: links } = await (supabaseAdmin as any)
          .from("document_links")
          .select("document_id, dossier_id, status")
          .eq("tenant_id", tenantId)
          .in("document_id", docIds)
          .neq("status", "rejected");

        for (const lnk of (links ?? []) as Array<{
          document_id: string;
          dossier_id: string;
        }>) {
          const sharedMentions = (mentions as Array<{
            document_id: string;
            normalized_value: string;
          }>).filter((m) => m.document_id === lnk.document_id);
          const sharedValues = Array.from(
            new Set(sharedMentions.map((m) => m.normalized_value)),
          );
          const cur = matches.get(lnk.dossier_id) ?? {
            dossierId: lnk.dossier_id,
            score: 0,
            signals: {},
          };
          cur.signals.sharedEntities = Array.from(
            new Set([...(cur.signals.sharedEntities ?? []), ...sharedValues]),
          );
          // Boost : 0.4 par entité forte partagée, capé à 0.5
          const boost = Math.min(0.5, sharedValues.length * 0.4);
          cur.score = Math.min(1, cur.score + boost);
          matches.set(lnk.dossier_id, cur);
        }
      }
    }
  }

  // ---- 3) Référence textuelle vs title/case_number
  const refs = entities.filter((e) => e.type === "dossier_ref").map((e) => e.raw);
  if (refs.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dossiers } = await (supabaseAdmin as any)
      .from("dossiers")
      .select("id, title, case_number")
      .eq("tenant_id", tenantId);
    for (const d of (dossiers ?? []) as Array<{
      id: string;
      title: string | null;
      case_number: string | null;
    }>) {
      const hay = `${d.title ?? ""} ${d.case_number ?? ""}`.toLowerCase();
      const found = refs.find((r) => hay.includes(r.toLowerCase()));
      if (!found) continue;
      const cur = matches.get(d.id) ?? { dossierId: d.id, score: 0, signals: {} };
      cur.signals.refMatch = found;
      cur.score = Math.min(1, cur.score + 0.35);
      matches.set(d.id, cur);
    }
  }

  return Array.from(matches.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
