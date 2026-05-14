// Server functions pour gérer les liens document↔dossier produits par
// processUploadedDocument (auto + suggérés).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";
import { processUploadedDocument } from "@/server/_shared/document-pipeline.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

// ─── Lister les suggestions en attente du tenant ────────────────────────────
export const listPendingLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);
    const { data, error } = await db
      .from("document_links")
      .select(
        "id, document_id, dossier_id, link_method, confidence, signals, created_at, document_analyses(filename, document_type:analysis), dossiers(title)",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("confidence", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { links: data ?? [] };
  });

// ─── Confirmer une suggestion ───────────────────────────────────────────────
export const confirmDocumentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ link_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);

    const { data: lnk, error } = await db
      .from("document_links")
      .update({
        status: "confirmed",
        link_method: "manual",
        confirmed_by: ctx.userId,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", data.link_id)
      .eq("tenant_id", tenantId)
      .select("document_id, dossier_id")
      .maybeSingle();

    if (error || !lnk) throw new Error(error?.message ?? "Lien introuvable");

    await logTimelineEvent({
      tenantId,
      dossierId: lnk.dossier_id,
      actorId: ctx.userId,
      eventType: "document.linked_manual",
      title: "Rattachement confirmé par l'utilisateur",
      metadata: { document_id: lnk.document_id, link_id: data.link_id },
    });

    // Re-jouer la partie indexation pour ce nouveau dossier confirmé
    try {
      await processUploadedDocument({
        documentId: lnk.document_id,
        tenantId,
        actorId: ctx.userId,
        forcedDossierId: lnk.dossier_id,
      });
    } catch (e) {
      console.error("[links] re-index failed", e);
    }

    return { ok: true };
  });

// ─── Rejeter une suggestion ─────────────────────────────────────────────────
export const rejectDocumentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ link_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);

    const { error } = await db
      .from("document_links")
      .update({ status: "rejected", confirmed_by: ctx.userId })
      .eq("id", data.link_id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Lister les liens d'un document (vue document → dossiers) ──────────────
export const getLinksForDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ document_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);
    const { data: links, error } = await db
      .from("document_links")
      .select("id, dossier_id, status, link_method, confidence, signals, dossiers(title)")
      .eq("tenant_id", tenantId)
      .eq("document_id", data.document_id);
    if (error) throw new Error(error.message);
    return { links: links ?? [] };
  });

// ─── Lister les documents liés à un dossier (vue Dossier 360) ──────────────
export const getDocumentsForDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ dossier_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);
    const { data: links, error } = await db
      .from("document_links")
      .select(
        "id, document_id, status, link_method, confidence, signals, document_analyses(id, filename, file_type, created_at, status, analysis)",
      )
      .eq("tenant_id", tenantId)
      .eq("dossier_id", data.dossier_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { links: links ?? [] };
  });
