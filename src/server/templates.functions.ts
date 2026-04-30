import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";

export const listDocumentTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      category: z.string().optional(),
      status: z.enum(["draft", "review", "validated", "deprecated", "all"]).optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    let q = supabaseAdmin
      .from("document_templates")
      .select("id, slug, name, description, category, risk_level, status, version, legal_basis, variables, icon, is_public, tenant_id, validated_at, updated_at, body, requires_upload, upload_optional, requires_form, requires_rag, requires_validation, archive_to_case, can_create_reminder, reminder_days_default, output_formats, prefill_sources, guidance, validation_threshold")
      .or(`is_public.eq.true,tenant_id.eq.${tenantId}`)
      .order("category", { ascending: true })
      .order("name", { ascending: true });
    if (data.category) q = q.eq("category", data.category);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as any[];
  });

export const getDocumentTemplate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { data: row, error } = await supabaseAdmin
      .from("document_templates")
      .select("*")
      .eq("id", data.id)
      .or(`is_public.eq.true,tenant_id.eq.${tenantId}`)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Modèle introuvable");
    return row as any;
  });

const variableSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "date", "number", "select", "textarea"]).default("text"),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

const legalBasisSchema = z.object({
  label: z.string(),
  reference: z.string().optional(),
  url: z.string().url().optional(),
});

export const upsertDocumentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(200),
      slug: z.string().trim().max(120).optional(),
      description: z.string().max(2000).optional(),
      category: z.string().min(1).max(80),
      risk_level: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      icon: z.string().max(40).optional(),
      body: z.string().min(1),
      variables: z.array(variableSchema).default([]),
      legal_basis: z.array(legalBasisSchema).default([]),
      status: z.enum(["draft", "review", "validated", "deprecated"]).default("draft"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const payload = {
      tenant_id: tenantId,
      created_by: userId,
      name: data.name,
      slug: data.slug ?? null,
      description: data.description ?? null,
      category: data.category,
      risk_level: data.risk_level,
      icon: data.icon ?? "FileText",
      body: data.body,
      variables: data.variables,
      legal_basis: data.legal_basis,
      status: data.status,
    };
    if (data.id) {
      const { error } = await (supabaseAdmin as any)
        .from("document_templates").update(payload).eq("id", data.id).eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await (supabaseAdmin as any)
      .from("document_templates").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: inserted.id as string };
  });

export const deleteDocumentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { error } = await supabaseAdmin
      .from("document_templates").delete().eq("id", data.id).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
