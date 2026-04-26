import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── Schemas ────────────────────────────────────────────────────────────────

const completeOnboardingSchema = z.object({
  fullName: z.string().min(1).max(120),
  jobTitle: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  companyName: z.string().min(1).max(200),
  siret: z.string().max(20).optional().nullable(),
  sector: z.string().max(120).optional().nullable(),
  idcc: z.string().max(20).optional().nullable(),
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ─── Complete onboarding: create tenant + assign admin role + mark profile ──

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => completeOnboardingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string; userEmail: string | null };
    const { userId, userEmail } = ctx;

    // 1. Generate unique slug
    const baseSlug = slugify(data.companyName) || "entreprise";
    let slug = baseSlug;
    let attempt = 0;
    while (attempt < 5) {
      const { data: existing } = await supabaseAdmin
        .from("tenants")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!existing) break;
      attempt++;
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    // 2. Create tenant
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .insert({
        name: data.companyName,
        slug,
        siret: data.siret ?? null,
        sector: data.sector ?? null,
        idcc: data.idcc ?? null,
        plan: "starter",
      })
      .select()
      .single();

    if (tenantErr || !tenant) {
      throw new Error(`Failed to create tenant: ${tenantErr?.message ?? "unknown"}`);
    }

    // 3. Assign admin role
    const { error: roleErr } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      tenant_id: tenant.id,
      role: "admin",
    });
    if (roleErr) {
      throw new Error(`Failed to assign role: ${roleErr.message}`);
    }

    // 4. Update profile (link tenant + mark onboarded)
    const { error: profileErr } = await supabaseAdmin
      .from("profiles")
      .update({
        tenant_id: tenant.id,
        full_name: data.fullName,
        job_title: data.jobTitle ?? null,
        phone: data.phone ?? null,
        onboarded: true,
        email: userEmail ?? "",
      })
      .eq("id", userId);

    if (profileErr) {
      throw new Error(`Failed to update profile: ${profileErr.message}`);
    }

    return { tenantId: tenant.id, slug: tenant.slug };
  });
