import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Untyped admin client to avoid type churn when DB schema evolves
const db = supabaseAdmin as unknown as {
  from: (table: string) => any;
};

// ─── Schemas ────────────────────────────────────────────────────────────────

// Rôles assignables via invitation (exclut super_admin/admin_tenant — non attribuables par l'UI).
const ASSIGNABLE_ROLE_VALUES = [
  "admin",
  "manager",
  "user",
  "dirigeant",
  "daf",
  "rh",
  "juriste",
  "comptable",
  "operationnel_terrain",
  "avocat_partenaire",
  "cabinet_comptable_admin",
  "collaborateur_cabinet",
] as const;

const inviteSchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(ASSIGNABLE_ROLE_VALUES).default("user"),
});

const acceptSchema = z.object({
  token: z.string().uuid(),
});

const revokeSchema = z.object({
  invitationId: z.string().uuid(),
});

// ─── Send invitation ────────────────────────────────────────────────────────

export const sendInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const { userId } = ctx;

    // 1. Get user's tenant + verify admin/manager role
    const { data: profile } = await db
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();

    if (!profile?.tenant_id) {
      throw new Error("Vous devez d'abord compléter l'onboarding");
    }
    const tenantId: string = profile.tenant_id;

    const { data: roles } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);

    const allowed = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "manager",
    );
    if (!allowed) {
      throw new Error("Seuls les admins et managers peuvent inviter");
    }

    // 2. Check if email already a member
    const { data: existingMember } = await db
      .from("profiles")
      .select("id")
      .eq("email", data.email)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (existingMember) {
      throw new Error("Cette personne est déjà membre de votre équipe");
    }

    // 3. Check pending invitation
    const { data: existingInvite } = await db
      .from("invitations")
      .select("id, accepted_at, expires_at")
      .eq("tenant_id", tenantId)
      .eq("email", data.email)
      .is("accepted_at", null)
      .maybeSingle();

    if (existingInvite && new Date(existingInvite.expires_at) > new Date()) {
      throw new Error("Une invitation est déjà en attente pour cet email");
    }

    // 4. Create invitation
    const { data: invite, error } = await db
      .from("invitations")
      .insert({
        tenant_id: tenantId,
        email: data.email.toLowerCase(),
        role: data.role,
        invited_by: userId,
      })
      .select("id, token, email, role, expires_at")
      .single();

    if (error || !invite) {
      throw new Error(`Échec de l'invitation : ${error?.message ?? "inconnu"}`);
    }

    return {
      id: invite.id as string,
      token: invite.token as string,
      email: invite.email as string,
      role: invite.role as "admin" | "manager" | "user",
      expiresAt: invite.expires_at as string,
    };
  });

// ─── Accept invitation (called after signup) ────────────────────────────────

export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => acceptSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string; userEmail: string | null };
    const { userId, userEmail } = ctx;

    // 1. Fetch invitation
    const { data: invite, error: inviteErr } = await db
      .from("invitations")
      .select("id, tenant_id, email, role, accepted_at, expires_at")
      .eq("token", data.token)
      .maybeSingle();

    if (inviteErr || !invite) {
      throw new Error("Invitation introuvable ou invalide");
    }
    const inv = invite as {
      id: string;
      tenant_id: string;
      email: string;
      role: "admin" | "manager" | "user";
      accepted_at: string | null;
      expires_at: string;
    };

    if (inv.accepted_at) {
      throw new Error("Cette invitation a déjà été acceptée");
    }
    if (new Date(inv.expires_at) < new Date()) {
      throw new Error("Cette invitation a expiré");
    }

    if (userEmail && userEmail.toLowerCase() !== inv.email.toLowerCase()) {
      throw new Error(
        `Cette invitation est destinée à ${inv.email}. Connectez-vous avec ce compte.`,
      );
    }

    // 2. Check user not already in another tenant
    const { data: profile } = await db
      .from("profiles")
      .select("tenant_id, onboarded")
      .eq("id", userId)
      .single();

    if (profile?.tenant_id && profile.tenant_id !== inv.tenant_id) {
      throw new Error("Vous appartenez déjà à une autre organisation");
    }

    // 3. Assign role (ignore if already exists)
    const { error: roleErr } = await db.from("user_roles").upsert(
      {
        user_id: userId,
        tenant_id: inv.tenant_id,
        role: inv.role,
      },
      { onConflict: "user_id,tenant_id,role" },
    );
    if (roleErr) {
      throw new Error(`Impossible d'assigner le rôle : ${roleErr.message}`);
    }

    // 4. Update profile
    const { error: profileErr } = await db
      .from("profiles")
      .update({
        tenant_id: inv.tenant_id,
        onboarded: true,
        email: userEmail ?? inv.email,
      })
      .eq("id", userId);
    if (profileErr) {
      throw new Error(`Impossible de mettre à jour le profil : ${profileErr.message}`);
    }

    // 5. Mark invitation accepted
    await db
      .from("invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", inv.id);

    return { tenantId: inv.tenant_id };
  });

// ─── Revoke invitation ──────────────────────────────────────────────────────

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => revokeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const { userId } = ctx;

    const { data: invite } = await db
      .from("invitations")
      .select("id, tenant_id")
      .eq("id", data.invitationId)
      .single();

    if (!invite) throw new Error("Invitation introuvable");

    // Verify admin/manager
    const { data: roles } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", invite.tenant_id);

    const allowed = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "manager",
    );
    if (!allowed) throw new Error("Permission refusée");

    await db.from("invitations").delete().eq("id", invite.id);
    return { ok: true };
  });
