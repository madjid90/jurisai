// processUploadedDocument : orchestrateur central post-ingestion d'un document.
//
// Chaîne (idempotent, non-bloquant si une étape secondaire échoue) :
//   1. Charger document_analyses (texte OCR/extrait)
//   2. Extraire les entités (entity_mentions)
//   3. findRelatedContext → liaisons document↔dossier
//      - score >= 0.80 → document_links auto/confirmed
//      - 0.50–0.80    → document_links suggested/pending
//   4. Indexer le résumé/texte dans dossier_context_index pour les dossiers liés
//   5. Logger un événement timeline sur chaque dossier impacté
//
// Idempotence : `entity_mentions` est purgé pour le doc avant ré-extraction.
// `document_links` utilise UNIQUE(document_id, dossier_id) avec upsert.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { extractEntities } from "./entity-extraction.server";
import { findRelatedContext } from "./context-link.server";
import { embedText, toPgVector } from "./embeddings.server";
import { logTimelineEvent } from "./timeline.server";

const AUTO_LINK_THRESHOLD = 0.8;
const SUGGEST_THRESHOLD = 0.5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

export type PipelineResult = {
  documentId: string;
  entitiesCount: number;
  autoLinked: string[];
  suggested: string[];
  indexedDossiers: string[];
  skippedReason?: string;
};

export async function processUploadedDocument(opts: {
  documentId: string;
  tenantId: string;
  actorId: string;
  /** Si fourni, force la liaison à ce dossier (lien manual confirmed). */
  forcedDossierId?: string | null;
}): Promise<PipelineResult> {
  const { documentId, tenantId, actorId, forcedDossierId } = opts;

  const result: PipelineResult = {
    documentId,
    entitiesCount: 0,
    autoLinked: [],
    suggested: [],
    indexedDossiers: [],
  };

  // ---- 1) Charger le document
  const { data: doc, error: docErr } = await db
    .from("document_analyses")
    .select("id, tenant_id, filename, extracted_text, analysis, dossier_id")
    .eq("id", documentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (docErr || !doc) {
    result.skippedReason = "document not found";
    return result;
  }

  const text = (doc.extracted_text ?? "") as string;
  if (text.length < 30) {
    result.skippedReason = "text too short";
    return result;
  }

  const analysis = (doc.analysis ?? {}) as {
    summary?: string;
    document_type?: string;
    domain?: string;
  };
  const summary = analysis.summary?.trim() || text.slice(0, 800);

  // ---- 2) Extraction entités (purge + ré-insert)
  await db.from("entity_mentions").delete().eq("document_id", documentId);
  const entities = extractEntities(text);
  if (entities.length) {
    await db.from("entity_mentions").insert(
      entities.map((e) => ({
        tenant_id: tenantId,
        document_id: documentId,
        entity_type: e.type,
        raw_value: e.raw.slice(0, 500),
        normalized_value: (e.normalized ?? e.raw).slice(0, 500),
        position_start: e.start ?? null,
        position_end: e.end ?? null,
      })),
    );
  }
  result.entitiesCount = entities.length;

  // ---- 3) Lien forcé (manuel) ou recherche contextuelle
  const linksToWrite: Array<{
    dossier_id: string;
    confidence: number;
    method: "auto" | "suggested" | "manual";
    status: "confirmed" | "pending";
    signals: Record<string, unknown>;
  }> = [];

  if (forcedDossierId) {
    linksToWrite.push({
      dossier_id: forcedDossierId,
      confidence: 1,
      method: "manual",
      status: "confirmed",
      signals: { source: "forced_by_caller" },
    });
  } else {
    const matches = await findRelatedContext({
      tenantId,
      text: `${summary}\n\n${text.slice(0, 3000)}`,
      entities,
      excludeDocumentId: documentId,
      topK: 5,
    });
    for (const m of matches) {
      if (m.score >= AUTO_LINK_THRESHOLD) {
        linksToWrite.push({
          dossier_id: m.dossierId,
          confidence: Number(m.score.toFixed(3)),
          method: "auto",
          status: "confirmed",
          signals: m.signals,
        });
      } else if (m.score >= SUGGEST_THRESHOLD) {
        linksToWrite.push({
          dossier_id: m.dossierId,
          confidence: Number(m.score.toFixed(3)),
          method: "suggested",
          status: "pending",
          signals: m.signals,
        });
      }
    }
  }

  // ---- 4) Persister les liens (upsert sur (document_id, dossier_id))
  for (const lnk of linksToWrite) {
    const row = {
      tenant_id: tenantId,
      document_id: documentId,
      dossier_id: lnk.dossier_id,
      link_method: lnk.method,
      confidence: lnk.confidence,
      status: lnk.status,
      signals: lnk.signals,
      confirmed_by: lnk.status === "confirmed" ? actorId : null,
      confirmed_at: lnk.status === "confirmed" ? new Date().toISOString() : null,
    };
    const { error } = await db
      .from("document_links")
      .upsert(row, { onConflict: "document_id,dossier_id" });
    if (error) {
      console.error("[pipeline] document_links upsert failed", error.message);
      continue;
    }
    if (lnk.status === "confirmed") result.autoLinked.push(lnk.dossier_id);
    else result.suggested.push(lnk.dossier_id);
  }

  // ---- 5) Indexer le résumé dans dossier_context_index pour chaque dossier confirmé
  const confirmedDossiers = Array.from(
    new Set([...(forcedDossierId ? [forcedDossierId] : []), ...result.autoLinked]),
  );
  if (confirmedDossiers.length) {
    const embedding = await embedText(summary);
    if (embedding) {
      const vec = toPgVector(embedding);
      for (const dossierId of confirmedDossiers) {
        // Purge ancien index pour ce doc dans ce dossier (évite doublons)
        await db
          .from("dossier_context_index")
          .delete()
          .eq("dossier_id", dossierId)
          .eq("source_kind", "document")
          .eq("source_ref", documentId);

        const { error } = await db.from("dossier_context_index").insert({
          tenant_id: tenantId,
          dossier_id: dossierId,
          content: summary.slice(0, 2000),
          embedding: vec,
          source_kind: "document",
          source_ref: documentId,
        });
        if (!error) result.indexedDossiers.push(dossierId);
      }
    }
  }

  // ---- 6) Timeline events
  for (const dossierId of result.autoLinked) {
    await logTimelineEvent({
      tenantId,
      dossierId,
      actorId,
      eventType: "document.linked_auto",
      title: `Document rattaché automatiquement : ${doc.filename}`,
      description: `Type: ${analysis.document_type ?? "n/c"} — domaine: ${analysis.domain ?? "n/c"}`,
      metadata: {
        document_id: documentId,
        method: forcedDossierId === dossierId ? "manual" : "auto",
        entities_count: entities.length,
      },
    });
  }
  for (const dossierId of result.suggested) {
    await logTimelineEvent({
      tenantId,
      dossierId,
      actorId,
      eventType: "document.link_suggested",
      title: `Suggestion de rattachement : ${doc.filename}`,
      description: "Confirmation utilisateur requise",
      metadata: { document_id: documentId, entities_count: entities.length },
    });
  }

  return result;
}
