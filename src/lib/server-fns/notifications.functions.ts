// Notifications & Préférences utilisateur — Priorité 5 JurisAI.
//
// Trois piliers :
//  1. Préférences (notification_preferences) — par user, scope tenant.
//  2. In-app notifications (notifications) — flux temps réel.
//  3. File email (email_queue) — envoi asynchrone respectant les préférences.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";

const NOTIFY_KINDS = [
  "rappel_retard",
  "action_requise",
  "risque_detecte",
  "echeance_proche",
  "workflow_bloque",
  "document_a_valider",
  "rapport_disponible",
  "nouvelle_mise_a_jour_juridique",
] as const;

type NotifyKind = (typeof NOTIFY_KINDS)[number];

// ─── Préférences ──────────────────────────────────────────────────────────────

export const getNotificationPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    const { data } = await supabaseAdmin
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (data) return data;

    // Defaults
    return {
      user_id: userId,
      tenant_id: tenantId,
      email_enabled: true,
      app_enabled: true,
      digest_frequency: "weekly",
      watched_domains: [] as string[],
      watched_update_types: [] as string[],
      watched_site_ids: [] as string[],
      watched_client_ids: [] as string[],
      notify_on: Object.fromEntries(NOTIFY_KINDS.map((k) => [k, true])),
    };
  });

export const updateNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email_enabled: z.boolean(),
        app_enabled: z.boolean(),
        digest_frequency: z.enum(["realtime", "daily", "weekly", "never"]),
        watched_domains: z.array(z.string()).max(20),
        watched_update_types: z.array(z.string()).max(20),
        watched_site_ids: z.array(z.string().uuid()).max(50),
        watched_client_ids: z.array(z.string().uuid()).max(50),
        notify_on: z.record(z.string(), z.boolean()),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    const { error } = await supabaseAdmin
      .from("notification_preferences")
      .upsert(
        { user_id: userId, tenant_id: tenantId, ...data, updated_at: new Date().toISOString() },
        { onConflict: "user_id,tenant_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── In-app notifications ────────────────────────────────────────────────────

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ unreadOnly: z.boolean().optional(), limit: z.number().min(1).max(100).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    let q = supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 30);
    if (data.unreadOnly) q = q.is("read_at", null);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ notificationId: z.string().uuid().optional(), all: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const now = new Date().toISOString();
    let q = supabaseAdmin.from("notifications").update({ read_at: now }).eq("user_id", userId);
    if (data.notificationId) q = q.eq("id", data.notificationId);
    else if (data.all) q = q.is("read_at", null);
    else throw new Error("Provide notificationId or all=true");
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const { error } = await supabaseAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// notifyUser a été déplacé vers ./_shared/notify.server.ts (importer directement de là).

