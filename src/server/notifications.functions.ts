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
import { getTenantId } from "./_shared/tenant.server";

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

    const { error } = await (supabaseAdmin as any)
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
    let q = (supabaseAdmin as any).from("notifications").update({ read_at: now }).eq("user_id", userId);
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
    const { error } = await (supabaseAdmin as any)
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Helper interne : créer une notification + email selon préférences ──────
// Réutilisable depuis n'importe quelle server function (workflows, dossiers, IA…).

export async function notifyUser(params: {
  userId: string;
  tenantId: string;
  kind: NotifyKind | string;
  title: string;
  body?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}) {
  const { userId, tenantId, kind, title, body, link, metadata = {} } = params;

  // Lire préférences
  const { data: pref } = await supabaseAdmin
    .from("notification_preferences")
    .select("app_enabled, email_enabled, notify_on, digest_frequency")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const p = pref as
    | {
        app_enabled: boolean;
        email_enabled: boolean;
        notify_on: Record<string, boolean>;
        digest_frequency: string;
      }
    | null;

  const allowed = !p || p.notify_on?.[kind] !== false;
  if (!allowed) return { skipped: true };

  // 1) In-app
  if (!p || p.app_enabled) {
    await (supabaseAdmin as any).from("notifications").insert({
      user_id: userId,
      tenant_id: tenantId,
      kind,
      title,
      body: body ?? null,
      link: link ?? null,
      metadata,
    });
  }

  // 2) Email (file d'envoi) — uniquement si realtime ; les digests sont gérés par cron séparé.
  if ((!p || p.email_enabled) && (!p || p.digest_frequency === "realtime")) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("id", userId)
      .maybeSingle();
    const email = (profile as { email?: string } | null)?.email;
    if (email) {
      const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
        ${body ? `<p style="color:#444;line-height:1.5">${escapeHtml(body)}</p>` : ""}
        ${link ? `<p><a href="${escapeAttr(link)}" style="color:#2563eb">Ouvrir dans JurisAI →</a></p>` : ""}
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#888;font-size:12px">Vous recevez cet email car vous suivez "${kind}". Modifiez vos préférences dans Réglages → Notifications.</p>
      </div>`;
      await (supabaseAdmin as any).from("email_queue").insert({
        tenant_id: tenantId,
        recipient_user_id: userId,
        recipient_email: email,
        template_key: `notif_${kind}`,
        subject: `[JurisAI] ${title}`,
        body_html: html,
        body_text: `${title}\n\n${body ?? ""}\n\n${link ?? ""}`,
        metadata: { kind, ...metadata },
      });
    }
  }

  return { ok: true };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function escapeAttr(s: string) {
  return escapeHtml(s);
}
