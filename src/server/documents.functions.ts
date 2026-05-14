import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";
import { fillTemplate as sharedFillTemplate } from "@/server/_shared/template";
import { AI_GATEWAY } from "@/server/_shared/constants.server";
import { sanitizePromptInput, PROMPT_INJECTION_GUARD } from "@/server/_shared/prompt-sanitizer.server";

const db = supabaseAdmin as unknown as {
  from: (table: string) => any;
};

// ─── Schemas ────────────────────────────────────────────────────────────────

const createDocSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().default(""),
  templateId: z.string().uuid().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  dossierId: z.string().uuid().optional(),
});

const updateDocSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(255).optional(),
  content: z.string().optional(),
  status: z.enum(["draft", "final"]).optional(),
  dossierId: z.string().uuid().nullable().optional(),
});

const deleteDocSchema = z.object({ id: z.string().uuid() });

const generateSchema = z.object({
  templateId: z.string().uuid().optional(),
  body: z.string().optional(),
  variables: z.record(z.string(), z.string()).default({}),
  prompt: z.string().max(2000).optional(),
  dossierId: z.string().uuid().optional(),
});

// ─── Resolve tenant (centralized) ───────────────────────────────────────────
import { getTenantId } from "@/server/_shared/tenant.server";

// ─── Create document ────────────────────────────────────────────────────────

export const createDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createDocSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);

    const { data: doc, error } = await db
      .from("documents")
      .insert({
        tenant_id: tenantId,
        user_id: ctx.userId,
        template_id: data.templateId ?? null,
        title: data.title,
        content: data.content,
        variables: data.variables ?? {},
        dossier_id: data.dossierId ?? null,
      })
      .select("id")
      .single();

    if (error || !doc) {
      throw new Error(`Création impossible : ${error?.message ?? "inconnu"}`);
    }

    if (data.dossierId) {
      await logTimelineEvent({
        tenantId,
        dossierId: data.dossierId,
        actorId: ctx.userId,
        eventType: "document.added",
        title: `Document créé : ${data.title}`,
        metadata: { document_id: doc.id, template_id: data.templateId ?? null },
      });
    }
    return { id: doc.id as string };
  });

// ─── Update document ────────────────────────────────────────────────────────

export const updateDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateDocSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);

    // Read current doc to know current dossier link & title
    const { data: existing } = await db
      .from("documents")
      .select("id, title, dossier_id")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const update: Record<string, unknown> = {};
    if (data.title !== undefined) update.title = data.title;
    if (data.content !== undefined) update.content = data.content;
    if (data.status !== undefined) update.status = data.status;
    if (data.dossierId !== undefined) update.dossier_id = data.dossierId;

    const { error } = await db
      .from("documents")
      .update(update)
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .eq("user_id", ctx.userId);

    if (error) throw new Error(`Mise à jour impossible : ${error.message}`);

    const dossierToLog =
      data.dossierId !== undefined ? data.dossierId : existing?.dossier_id ?? null;
    if (dossierToLog) {
      await logTimelineEvent({
        tenantId,
        dossierId: dossierToLog,
        actorId: ctx.userId,
        eventType: data.status === "final" ? "document.finalized" : "document.updated",
        title: `Document mis à jour : ${data.title ?? existing?.title ?? "—"}`,
        metadata: { document_id: data.id, status: data.status ?? null },
      });
    }
    return { ok: true };
  });

// ─── Delete document ────────────────────────────────────────────────────────

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deleteDocSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);

    const { data: existing } = await db
      .from("documents")
      .select("id, title, dossier_id")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const { error } = await db
      .from("documents")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .eq("user_id", ctx.userId);
    if (error) throw new Error(`Suppression impossible : ${error.message}`);

    if (existing?.dossier_id) {
      await logTimelineEvent({
        tenantId,
        dossierId: existing.dossier_id,
        actorId: ctx.userId,
        eventType: "document.deleted",
        title: `Document supprimé : ${existing.title ?? "—"}`,
        metadata: { document_id: data.id },
      });
    }
    return { ok: true };
  });

// ─── Generate from template ─────────────────────────────────────────────────
// Two modes:
//  1. Pure template fill (no AI) — replaces {{var}} tokens with provided values.
//  2. AI enhancement (when prompt is provided) — uses Lovable AI Gateway to
//     personalize / refine the rendered text.

// G5 — délègue au helper partagé `fillTemplate` mais conserve le marqueur
// HTML pour les variables manquantes (utile dans l'éditeur de génération).
function fillTemplate(body: string, variables: Record<string, string>): string {
  return sharedFillTemplate(body, variables, {
    onMissing: (key) =>
      `<span data-missing="${key}" style="background:#fef3c7;color:#92400e;padding:0 4px;border-radius:3px">[${key}]</span>`,
  });
}

export const generateDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => generateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);

    if (data.dossierId) {
      await logTimelineEvent({
        tenantId,
        dossierId: data.dossierId,
        actorId: ctx.userId,
        eventType: "document.generated",
        title: data.templateId
          ? "Document généré depuis un modèle"
          : "Document généré",
        metadata: {
          template_id: data.templateId ?? null,
          ai_assisted: Boolean(data.prompt && data.prompt.trim().length > 0),
        },
      });
    }

    let body = data.body ?? "";

    if (data.templateId) {
      const { data: tpl, error } = await db
        .from("document_templates")
        .select("body")
        .eq("id", data.templateId)
        .maybeSingle();
      if (error || !tpl) throw new Error("Modèle introuvable");
      body = tpl.body as string;
    }

    if (!body) throw new Error("Aucun contenu à générer");

    const filled = fillTemplate(body, data.variables);

    // No AI prompt → return filled template directly
    if (!data.prompt || data.prompt.trim().length === 0) {
      return { content: filled };
    }

    // AI enhancement via Lovable AI Gateway
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      // Fallback: return filled template if AI is not configured
      return { content: filled };
    }

    const systemPrompt = `Tu es un assistant juridique français. Tu aides à rédiger un document professionnel en français.
RÈGLES :
- Conserve la structure HTML fournie (paragraphes, titres, listes).
- Adapte uniquement le ton, ajoute les précisions demandées et corrige le style.
- Ne supprime pas les sections obligatoires.
- Réponds UNIQUEMENT avec le HTML du document final, sans markdown, sans explication.

${PROMPT_INJECTION_GUARD}`;

    const safePrompt = sanitizePromptInput(data.prompt!, { label: "INSTRUCTION_UTILISATEUR", maxLength: 2000 });
    const userPrompt = `Document de base (HTML) :
${filled}

Instruction de l'utilisateur : ${safePrompt}

Réponds avec le HTML final du document.`;

    try {
      const res = await fetch(`${AI_GATEWAY}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!res.ok) {
        console.error("AI gateway error", res.status, await res.text());
        return { content: filled };
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const aiContent = json.choices?.[0]?.message?.content?.trim();
      if (!aiContent) return { content: filled };

      // Strip markdown code fences if the model wrapped HTML in ```html ... ```
      const cleaned = aiContent
        .replace(/^```(?:html)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      return { content: cleaned };
    } catch (err) {
      console.error("AI generation failed", err);
      return { content: filled };
    }
  });
