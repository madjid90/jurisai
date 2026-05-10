// Helper interne — création de notifications in-app + file email selon préférences.
// Server-only (utilise supabaseAdmin). À importer uniquement depuis des .server.ts / .functions.ts.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function notifyUser(params: {
  userId: string;
  tenantId: string;
  kind: string;
  title: string;
  body?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}) {
  const { userId, tenantId, kind, title, body, link, metadata = {} } = params;

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
      await supabaseAdmin.from("email_queue").insert({
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
