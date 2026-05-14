import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantId } from "@/server/_shared/tenant.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";

type Ctx = { userId: string; supabase: SupabaseClient };

// ─── Schemas ────────────────────────────────────────────────────────────────

const clientSchema = z.object({
  full_name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  job_title: z.string().max(150).optional().or(z.literal("")),
  contract_type: z.string().max(50).optional().or(z.literal("")),
  hire_date: z.string().optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
});

const updateClientSchema = clientSchema.partial().extend({
  id: z.string().uuid(),
});

const dossierSchema = z.object({
  client_id: z.string().uuid().optional().or(z.literal("")),
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional().or(z.literal("")),
  category: z.string().max(50).default("autre"),
  status: z.enum(["open", "in_progress", "closed"]).default("open"),
  risk_level: z.enum(["low", "medium", "high"]).default("low"),
});

const updateDossierSchema = dossierSchema.partial().extend({
  id: z.string().uuid(),
});

const deadlineSchema = z.object({
  dossier_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional().or(z.literal("")),
  due_date: z.string().min(1),
});

const updateDeadlineSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().or(z.literal("")),
  due_date: z.string().optional(),
  completed: z.boolean().optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

function cleanEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

// ─── Clients ────────────────────────────────────────────────────────────────

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { data, error } = await ctx.supabase
      .from("clients")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return { clients: data ?? [] };
  });

export const getClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { data: client, error } = await ctx.supabase
      .from("clients")
      .select("*")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) throw new Error("Client introuvable");

    const { data: dossiers } = await ctx.supabase
      .from("dossiers")
      .select("*")
      .eq("client_id", data.id)
      .order("created_at", { ascending: false })
      .limit(100);

    return { client, dossiers: dossiers ?? [] };
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => clientSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const payload = {
      ...cleanEmpty(data),
      tenant_id: tenantId,
      created_by: ctx.userId,
    };
    const { data: client, error } = await ctx.supabase
      .from("clients")
      .insert(payload as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { client };
  });

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateClientSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { id, ...rest } = data;
    const { data: client, error } = await ctx.supabase
      .from("clients")
      .update(cleanEmpty(rest) as never)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { client };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { error } = await ctx.supabase
      .from("clients")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// ─── Dossiers ───────────────────────────────────────────────────────────────

const listDossiersSchema = z
  .object({ limit: z.number().min(1).max(100).optional(), offset: z.number().min(0).optional() })
  .optional();

export const listDossiers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listDossiersSchema.parse(input ?? {}) ?? {})
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const limit = data?.limit ?? 30;
    const offset = data?.offset ?? 0;
    const { data: rows, error, count } = await ctx.supabase
      .from("dossiers")
      .select("*, client:clients(id, full_name)", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { dossiers: rows ?? [], total: count ?? 0, hasMore: (rows?.length ?? 0) === limit };
  });

export const getDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { data: dossier, error } = await ctx.supabase
      .from("dossiers")
      .select("*, client:clients(id, full_name, job_title)")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!dossier) throw new Error("Dossier introuvable");

    const { data: deadlines } = await ctx.supabase
      .from("dossier_deadlines")
      .select("*")
      .eq("dossier_id", data.id)
      .order("due_date", { ascending: true });

    return { dossier, deadlines: deadlines ?? [] };
  });

export const createDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => dossierSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const payload = {
      ...cleanEmpty(data),
      tenant_id: tenantId,
      created_by: ctx.userId,
    };
    const { data: dossier, error } = await ctx.supabase
      .from("dossiers")
      .insert(payload as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logTimelineEvent({
      tenantId,
      dossierId: (dossier as { id: string }).id,
      actorId: ctx.userId,
      eventType: "dossier.created",
      title: `Dossier créé`,
      description: (dossier as { title?: string }).title ?? null,
    });
    return { dossier };
  });

export const updateDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateDossierSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { id, ...rest } = data;
    const cleaned = cleanEmpty(rest) as Record<string, unknown>;
    if (cleaned.status === "closed") cleaned.closed_at = new Date().toISOString();
    if (cleaned.status && cleaned.status !== "closed") cleaned.closed_at = null;
    const { data: dossier, error } = await ctx.supabase
      .from("dossiers")
      .update(cleaned as never)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    if (cleaned.status) {
      await logTimelineEvent({
        tenantId,
        dossierId: id,
        actorId: ctx.userId,
        eventType: "dossier.status_changed",
        title: `Statut → ${String(cleaned.status)}`,
        metadata: { new_status: cleaned.status },
      });
    }
    return { dossier };
  });

export const deleteDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { error } = await ctx.supabase
      .from("dossiers")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// ─── Deadlines ──────────────────────────────────────────────────────────────

export const listDeadlines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { data, error } = await ctx.supabase
      .from("dossier_deadlines")
      .select("*, dossier:dossiers(id, title, client:clients(id, full_name))")
      .eq("tenant_id", tenantId)
      .order("due_date", { ascending: true });
    if (error) throw new Error(error.message);
    return { deadlines: data ?? [] };
  });

export const createDeadline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deadlineSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { data: dossier } = await ctx.supabase
      .from("dossiers")
      .select("id")
      .eq("id", data.dossier_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!dossier) throw new Error("Dossier introuvable");

    const payload = {
      dossier_id: data.dossier_id,
      title: data.title,
      description: data.description || null,
      due_date: data.due_date,
      tenant_id: tenantId,
      created_by: ctx.userId,
    };
    const { data: deadline, error } = await ctx.supabase
      .from("dossier_deadlines")
      .insert(payload as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { deadline };
  });

export const updateDeadline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateDeadlineSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { id, ...rest } = data;
    const cleaned = cleanEmpty(rest) as Record<string, unknown>;
    if (cleaned.completed === true) cleaned.completed_at = new Date().toISOString();
    if (cleaned.completed === false) cleaned.completed_at = null;
    const { data: deadline, error } = await ctx.supabase
      .from("dossier_deadlines")
      .update(cleaned as never)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { deadline };
  });

export const deleteDeadline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const tenantId = await getTenantId(ctx.userId);
    const { error } = await ctx.supabase
      .from("dossier_deadlines")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
