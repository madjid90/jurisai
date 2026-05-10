import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getTenantId } from "@/server/_shared/tenant.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";
import { processUploadedDocument } from "@/server/_shared/document-pipeline.server";

const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL manquant côté serveur (configurez la variable d'environnement)");
}

export const runOcrDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      storage_path: z.string().min(1),
      filename: z.string().min(1).max(200),
      file_type: z.string().min(1).max(100),
      dossier_id: z.string().uuid().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { accessToken?: string; userId: string };
    const accessToken = ctx.accessToken ?? "";
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ocr-document`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OCR ${res.status}: ${text || res.statusText}`);
    }
    const result = (await res.json()) as { id: string; text: string; length: number };

    const tenantId = await getTenantId(ctx.userId);

    if (data.dossier_id) {
      try {
        await logTimelineEvent({
          tenantId,
          dossierId: data.dossier_id,
          actorId: ctx.userId,
          eventType: "document.ocr_completed",
          title: `OCR effectué : ${data.filename}`,
          metadata: {
            document_id: result.id,
            text_length: result.length,
            file_type: data.file_type,
          },
        });
      } catch (e) {
        console.error("[ocr] timeline log failed", e);
      }
    }

    // Pipeline auto (entités → contexte → liaison → index → timeline). Non bloquant.
    let pipeline: Awaited<ReturnType<typeof processUploadedDocument>> | null = null;
    try {
      pipeline = await processUploadedDocument({
        documentId: result.id,
        tenantId,
        actorId: ctx.userId,
        forcedDossierId: data.dossier_id ?? null,
      });
    } catch (e) {
      console.error("[ocr] pipeline failed", e);
    }

    return { ...result, pipeline };
  });
