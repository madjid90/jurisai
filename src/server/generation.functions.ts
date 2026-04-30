// Génération de documents — sessions guidées + génération + validation hiérarchique.
// Workflow JurisAI : Comprendre → Sourcer → Proposer → Préparer → Valider → Exécuter → Archiver.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";

const db = supabaseAdmin as unknown as { from: (t: string) => any };

// ─── Helpers ────────────────────────────────────────────────────────────────

function fillTemplate(body: string, variables: Record<string, unknown>): {
  filled: string;
  missing: string[];
} {
  const missing: string[] = [];
  const filled = body.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key: string) => {
    const v = variables[key];
    if (v === undefined || v === null || v === "") {
      missing.push(key);
      return `<span data-missing="${key}" class="bg-amber-100 text-amber-900 px-1 rounded">[${key}]</span>`;
    }
    return String(v);
  });
  return { filled, missing: Array.from(new Set(missing)) };
}

// ─── Sessions guidées ───────────────────────────────────────────────────────

export const startGenerationSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      template_id: z.string().uuid(),
      dossier_id: z.string().uuid().optional(),
      scenario: z.enum(["no_upload", "from_upload", "from_dossier"]).default("no_upload"),
      uploaded_document_analysis_id: z.string().uuid().optional(),
      prefilled_data: z.record(z.string(), z.any()).default({}),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    const { data: session, error } = await db
      .from("document_generation_sessions")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        template_id: data.template_id,
        dossier_id: data.dossier_id ?? null,
        scenario: data.scenario,
        uploaded_document_analysis_id: data.uploaded_document_analysis_id ?? null,
        prefilled_data: data.prefilled_data,
        collected_data: data.prefilled_data,
        status: "in_progress",
        current_step: "collect_fields",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    if (data.dossier_id) {
      await logTimelineEvent({
        tenantId,
        dossierId: data.dossier_id,
        actorId: userId,
        eventType: "generation.started",
        title: "Session de génération de document démarrée",
        metadata: { session_id: session.id, template_id: data.template_id, scenario: data.scenario },
      });
    }
    return { session_id: session.id as string };
  });

export const getGenerationSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { data: row, error } = await db
      .from("document_generation_sessions")
      .select("*, document_templates(*)")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Session introuvable");
    return row as any;
  });

export const updateGenerationSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      collected_data: z.record(z.string(), z.any()).optional(),
      current_step: z.string().optional(),
      status: z.enum(["in_progress", "ready_to_generate", "validated", "cancelled"]).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.collected_data) update.collected_data = data.collected_data;
    if (data.current_step) update.current_step = data.current_step;
    if (data.status) update.status = data.status;
    const { error } = await db
      .from("document_generation_sessions")
      .update(update)
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Génération du document final ───────────────────────────────────────────

export const finalizeGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      session_id: z.string().uuid(),
      title: z.string().min(1).max(255).optional(),
      ai_polish: z.boolean().default(false),
      ai_instruction: z.string().max(2000).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    const { data: session, error: sErr } = await db
      .from("document_generation_sessions")
      .select("*, document_templates(*)")
      .eq("id", data.session_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (sErr || !session) throw new Error("Session introuvable");

    const tpl = session.document_templates;
    if (!tpl) throw new Error("Modèle introuvable");

    const collected = (session.collected_data ?? {}) as Record<string, unknown>;
    const { filled, missing } = fillTemplate(tpl.body as string, collected);

    let finalContent = filled;

    // Polish IA optionnel via Lovable AI Gateway
    if (data.ai_polish) {
      const apiKey = process.env.LOVABLE_API_KEY;
      if (apiKey) {
        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                {
                  role: "system",
                  content: `Tu es assistant juridique français. Améliore le style et la clarté d'un document juridique tout en :
- conservant strictement la structure HTML
- ne supprimant aucune clause légale
- ne modifiant aucune valeur factuelle (montants, dates, noms)
- répondant uniquement avec le HTML final, sans markdown ni commentaire.`,
                },
                {
                  role: "user",
                  content: `Document :\n${filled}\n\nInstruction : ${data.ai_instruction ?? "Améliore le style juridique."}`,
                },
              ],
            }),
          });
          if (res.ok) {
            const json: any = await res.json();
            const ai = json.choices?.[0]?.message?.content?.trim();
            if (ai) {
              finalContent = ai
                .replace(/^```(?:html)?\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();
            }
          }
        } catch (e) {
          console.error("AI polish failed", e);
        }
      }
    }

    const status = (tpl.risk_level === "high" || tpl.risk_level === "critical") ? "pending_validation" : "draft";
    const title = data.title ?? `${tpl.name} — ${new Date().toLocaleDateString("fr-FR")}`;

    const { data: doc, error: dErr } = await db
      .from("generated_documents")
      .insert({
        tenant_id: tenantId,
        session_id: data.session_id,
        template_id: tpl.id,
        dossier_id: session.dossier_id,
        generated_by: userId,
        title,
        content_html: finalContent,
        output_format: "html",
        variables_used: collected,
        status,
      })
      .select("id, status")
      .single();
    if (dErr) throw new Error(dErr.message);

    await db
      .from("document_generation_sessions")
      .update({ status: "validated", current_step: "generated", updated_at: new Date().toISOString() })
      .eq("id", data.session_id);

    // Demande de validation auto pour risque élevé
    let validationId: string | null = null;
    if (status === "pending_validation") {
      const { data: admins } = await db
        .from("user_roles")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("role", "admin")
        .limit(1);
      const assignee = admins?.[0]?.user_id ?? userId;
      const { data: vr } = await db
        .from("validation_requests")
        .insert({
          tenant_id: tenantId,
          dossier_id: session.dossier_id,
          requester_id: userId,
          assigned_to: assignee,
          subject_type: "generated_document",
          subject_id: doc.id,
          context: { template: tpl.name, risk_level: tpl.risk_level },
          status: "pending",
        })
        .select("id")
        .single();
      validationId = vr?.id ?? null;
    }

    if (session.dossier_id) {
      await logTimelineEvent({
        tenantId,
        dossierId: session.dossier_id,
        actorId: userId,
        eventType: status === "pending_validation" ? "document.generated_pending_validation" : "document.generated",
        title: `Document généré — ${tpl.name}`,
        description: missing.length ? `Champs manquants : ${missing.join(", ")}` : null,
        metadata: { document_id: doc.id, template_id: tpl.id, missing, risk_level: tpl.risk_level },
      });
    }

    return {
      document_id: doc.id as string,
      status: doc.status as string,
      missing,
      validation_id: validationId,
    };
  });

// ─── Lecture des documents générés ──────────────────────────────────────────

export const listGeneratedDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      dossier_id: z.string().uuid().optional(),
      status: z.string().optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    let q = db
      .from("generated_documents")
      .select("id, title, status, output_format, dossier_id, template_id, created_at, validated_at, document_templates(name, category, risk_level)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.dossier_id) q = q.eq("dossier_id", data.dossier_id);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as any[];
  });

export const getGeneratedDocument = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { data: row, error } = await db
      .from("generated_documents")
      .select("*, document_templates(name, category, risk_level, legal_basis)")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Document introuvable");
    return row as any;
  });
