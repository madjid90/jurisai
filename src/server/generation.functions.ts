// Génération de documents — sessions guidées + génération + validation hiérarchique.
// Workflow JurisAI : Comprendre → Sourcer → Proposer → Préparer → Valider → Exécuter → Archiver → Suivre.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";
import { prefillSession } from "@/server/_shared/prefill.server";
import { shouldRequestValidation, type TemplateField, type PrefillSource } from "@/lib/templates/template-config";

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

function templateFields(tpl: any): TemplateField[] {
  const v = tpl?.variables;
  return Array.isArray(v) ? (v as TemplateField[]) : [];
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

    // Charge le modèle pour récupérer la config + les champs
    const { data: tpl, error: tplErr } = await db
      .from("document_templates")
      .select("*")
      .eq("id", data.template_id)
      .or(`is_public.eq.true,tenant_id.eq.${tenantId}`)
      .maybeSingle();
    if (tplErr || !tpl) throw new Error("Modèle introuvable");

    const fields = templateFields(tpl);
    const enabledSources: PrefillSource[] = Array.isArray(tpl.prefill_sources) ? tpl.prefill_sources : [];

    // Pré-remplissage automatique
    let prefill = { data: {} as Record<string, unknown>, metadata: {} as Record<string, unknown>, uncertain: [] as Array<{ key: string; reason: string }> };
    if (enabledSources.length > 0 && (data.dossier_id || data.uploaded_document_analysis_id)) {
      prefill = await prefillSession(fields, {
        tenantId,
        dossierId: data.dossier_id,
        uploadedAnalysisId: data.uploaded_document_analysis_id,
        enabledSources,
      });
    }

    const collected = { ...prefill.data, ...data.prefilled_data };

    const { data: session, error } = await db
      .from("document_generation_sessions")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        template_id: data.template_id,
        dossier_id: data.dossier_id ?? null,
        scenario: data.scenario,
        uploaded_document_analysis_id: data.uploaded_document_analysis_id ?? null,
        prefilled_data: prefill.data,
        prefill_metadata: prefill.metadata,
        uncertain_fields: prefill.uncertain,
        collected_data: collected,
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
        title: `Session de génération démarrée — ${tpl.name}`,
        metadata: { session_id: session.id, template_id: data.template_id, scenario: data.scenario },
      });
    }
    return {
      session_id: session.id as string,
      prefilled_data: prefill.data as Record<string, any>,
      prefill_metadata: prefill.metadata as Record<string, any>,
      uncertain_fields: prefill.uncertain,
    };
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
      reminder_after_days: z.number().int().min(1).max(3650).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.collected_data) update.collected_data = data.collected_data;
    if (data.current_step) update.current_step = data.current_step;
    if (data.status) update.status = data.status;
    if (data.reminder_after_days !== undefined) update.reminder_after_days = data.reminder_after_days;
    const { error } = await db
      .from("document_generation_sessions")
      .update(update)
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Sourcing RAG (optionnel, déclenché si requires_rag) ────────────────────

export const fetchTemplateLegalSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      session_id: z.string().uuid(),
      query: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { data: session } = await db
      .from("document_generation_sessions")
      .select("id")
      .eq("id", data.session_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!session) throw new Error("Session introuvable");

    // Recherche hybrid simple via legal_chunks (texte). L'embedding-search est géré ailleurs.
    const { data: rows } = await db
      .from("legal_chunks")
      .select("id, title, source_label, source_url, content")
      .textSearch("content", data.query.split(" ").slice(0, 6).join(" | "), { type: "plain" })
      .limit(5);

    const sources = (rows ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      label: r.source_label,
      url: r.source_url,
      excerpt: (r.content ?? "").slice(0, 240),
    }));

    await db
      .from("document_generation_sessions")
      .update({ legal_sources_used: sources, updated_at: new Date().toISOString() })
      .eq("id", data.session_id);

    return { sources };
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
      output_format: z.enum(["html", "pdf", "docx", "email"]).default("html"),
      reminder_after_days: z.number().int().min(1).max(3650).nullable().optional(),
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

    // Décision validation : config + risk_level
    const requiresValidation = shouldRequestValidation(tpl.risk_level as string, {
      requires_validation: !!tpl.requires_validation,
      validation_threshold: (tpl.validation_threshold as any) ?? "auto",
    });
    const status = requiresValidation ? "pending_validation" : "draft";
    const title = data.title ?? `${tpl.name} — ${new Date().toLocaleDateString("fr-FR")}`;
    const legalSources = Array.isArray(session.legal_sources_used) ? session.legal_sources_used : [];

    const { data: doc, error: dErr } = await db
      .from("generated_documents")
      .insert({
        tenant_id: tenantId,
        session_id: data.session_id,
        template_id: tpl.id,
        dossier_id: tpl.archive_to_case === false ? null : session.dossier_id,
        generated_by: userId,
        title,
        content_html: finalContent,
        output_format: data.output_format,
        variables_used: collected,
        legal_sources: legalSources,
        status,
      })
      .select("id, status")
      .single();
    if (dErr) throw new Error(dErr.message);

    await db
      .from("document_generation_sessions")
      .update({
        status: "validated",
        current_step: "generated",
        updated_at: new Date().toISOString(),
      })
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
          requested_by: userId,
          assigned_to: assignee,
          subject_type: "generated_document",
          subject_id: doc.id,
          comment: `Validation requise — ${tpl.name} (risque ${tpl.risk_level})`,
          status: "pending",
        })
        .select("id")
        .single();
      validationId = vr?.id ?? null;
    }

    // Création d'un rappel de suivi (post-génération) si demandé par l'utilisateur ou config
    let reminderId: string | null = null;
    const reminderDays = data.reminder_after_days ?? (tpl.can_create_reminder ? tpl.reminder_days_default : null);
    if (reminderDays && reminderDays > 0 && session.dossier_id) {
      const due = new Date();
      due.setDate(due.getDate() + reminderDays);
      const { data: r } = await db
        .from("reminders")
        .insert({
          tenant_id: tenantId,
          dossier_id: session.dossier_id,
          created_by: userId,
          assigned_to: userId,
          title: `Suivi — ${title}`,
          description: `Rappel automatique ${reminderDays} jours après génération.`,
          due_at: due.toISOString(),
          status: "pending",
        })
        .select("id")
        .single();
      reminderId = r?.id ?? null;
      if (reminderId) {
        await db.from("generated_documents").update({ reminder_id: reminderId }).eq("id", doc.id);
      }
    }

    if (session.dossier_id && tpl.archive_to_case !== false) {
      await logTimelineEvent({
        tenantId,
        dossierId: session.dossier_id,
        actorId: userId,
        eventType: status === "pending_validation" ? "document.generated_pending_validation" : "document.generated",
        title: `Document généré — ${tpl.name}`,
        description: missing.length ? `Champs manquants : ${missing.join(", ")}` : null,
        metadata: {
          document_id: doc.id,
          template_id: tpl.id,
          missing,
          risk_level: tpl.risk_level,
          legal_sources_count: legalSources.length,
          reminder_id: reminderId,
        },
      });
    }

    return {
      document_id: doc.id as string,
      status: doc.status as string,
      missing,
      validation_id: validationId,
      reminder_id: reminderId,
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
