import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as unknown as { from: (table: string) => any };
const auth = supabaseAdmin.auth as unknown as {
  admin: { deleteUser: (id: string) => Promise<{ error: { message: string } | null }> };
};

// ─── Export all user data (RGPD article 20) ─────────────────────────────────

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { userId: string; userEmail: string | null };
    const { userId, userEmail } = ctx;

    const { data: profile } = await db
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    const { data: roles } = await db
      .from("user_roles")
      .select("role, tenant_id, created_at")
      .eq("user_id", userId);

    const { data: conversations } = await db
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("user_id", userId);

    const conversationIds = ((conversations as Array<{ id: string }>) ?? []).map(
      (c) => c.id,
    );

    let messages: any[] = [];
    if (conversationIds.length > 0) {
      const { data: msgs } = await db
        .from("messages")
        .select("id, conversation_id, role, content, created_at")
        .in("conversation_id", conversationIds);
      messages = (msgs as any[]) ?? [];
    }

    const { data: documents } = await db
      .from("documents")
      .select("id, title, status, content, variables, created_at, updated_at")
      .eq("user_id", userId);

    return {
      exportedAt: new Date().toISOString(),
      account: { id: userId, email: userEmail },
      profile,
      roles: roles ?? [],
      conversations: conversations ?? [],
      messages,
      documents: documents ?? [],
    };
  });

// ─── Delete account (RGPD article 17) ───────────────────────────────────────

const deleteSchema = z.object({
  confirmation: z.literal("SUPPRIMER"),
});

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deleteSchema.parse(input))
  .handler(async ({ context }) => {
    const ctx = context as { userId: string };
    const { userId } = ctx;

    // Cascade: messages → conversations, then documents, roles, profile, auth user
    const { data: convs } = await db
      .from("conversations")
      .select("id")
      .eq("user_id", userId);

    const convIds = ((convs as Array<{ id: string }>) ?? []).map((c) => c.id);
    if (convIds.length > 0) {
      await db.from("messages").delete().in("conversation_id", convIds);
      await db.from("conversations").delete().in("id", convIds);
    }

    await db.from("documents").delete().eq("user_id", userId);
    await db.from("user_roles").delete().eq("user_id", userId);
    await db.from("profiles").delete().eq("id", userId);

    const { error } = await auth.admin.deleteUser(userId);
    if (error) {
      throw new Error(`Suppression du compte impossible : ${error.message}`);
    }

    return { ok: true };
  });
