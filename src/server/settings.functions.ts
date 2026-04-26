import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── Update tenant (admin only) ─────────────────────────────────────────────

const updateTenantSchema = z.object({
  name: z.string().min(1).max(200),
  siret: z.string().max(20).optional().nullable(),
  sector: z.string().max(120).optional().nullable(),
  idcc: z.string().max(20).optional().nullable(),
});

export const updateTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateTenantSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const { userId } = ctx;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();

    if (!profile?.tenant_id) {
      throw new Error("Aucune organisation associée");
    }
    const tenantId = profile.tenant_id;

    // Verify admin
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);

    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) {
      throw new Error("Seuls les administrateurs peuvent modifier l'organisation");
    }

    const { error } = await (supabaseAdmin as any)
      .from("tenants")
      .update({
        name: data.name,
        siret: data.siret ?? null,
        sector: data.sector ?? null,
        idcc: data.idcc ?? null,
      })
      .eq("id", tenantId);

    if (error) throw new Error(`Échec de la mise à jour : ${error.message}`);

    return { ok: true };
  });

// ─── Update profile (any user, own profile) ─────────────────────────────────

const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(120),
  jobTitle: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
});

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateProfileSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const { userId } = ctx;

    const { error } = await (supabaseAdmin as any)
      .from("profiles")
      .update({
        full_name: data.fullName,
        job_title: data.jobTitle ?? null,
        phone: data.phone ?? null,
      })
      .eq("id", userId);

    if (error) throw new Error(`Échec : ${error.message}`);
    return { ok: true };
  });

// ─── Remove member from tenant (admin only) ─────────────────────────────────

const removeMemberSchema = z.object({
  memberId: z.string().uuid(),
});

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => removeMemberSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const { userId } = ctx;

    if (data.memberId === userId) {
      throw new Error("Vous ne pouvez pas vous retirer vous-même");
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    if (!profile?.tenant_id) throw new Error("Aucune organisation");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", profile.tenant_id);

    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) throw new Error("Permission refusée");

    // Delete user's roles in this tenant
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.memberId)
      .eq("tenant_id", profile.tenant_id);

    // Unlink profile from tenant
    await (supabaseAdmin as any)
      .from("profiles")
      .update({ tenant_id: null, onboarded: false })
      .eq("id", data.memberId)
      .eq("tenant_id", profile.tenant_id);

    return { ok: true };
  });
