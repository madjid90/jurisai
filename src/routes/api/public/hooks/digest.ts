// Cron hook : digest quotidien / hebdomadaire JurisAI.
//
// Appelé par pg_cron (voir migration). Il :
//  1. Sélectionne les users dont digest_frequency ∈ ('daily','weekly') selon le mode demandé.
//  2. Récupère les notifications non lues + alertes / mises à jour juridiques pertinentes
//     depuis la dernière exécution.
//  3. Génère un email récapitulatif et le pousse dans email_queue.
//  4. Trace l'exécution dans digest_runs.
//
// Sécurité : nous validons l'apikey transmise par pg_cron (= anon key) — toute requête
// sans cette clé est rejetée. Comme la route ne renvoie aucune donnée sensible, c'est
// un compromis raisonnable, en attendant un secret HMAC dédié.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BodySchema = z.object({
  frequency: z.enum(["daily", "weekly"]).default("daily"),
});

type Notif = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
};

type UserRow = {
  user_id: string;
  tenant_id: string;
  email_enabled: boolean;
  digest_frequency: string;
  email: string | null;
  full_name: string | null;
};

export const Route = createFileRoute("/api/public/hooks/digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth simple : apikey doit correspondre à l'anon key
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: { frequency?: string } = {};
        try {
          body = await request.json();
        } catch {
          // empty body OK
        }
        const { frequency } = BodySchema.parse(body);
        const sinceDays = frequency === "weekly" ? 7 : 1;
        const sinceIso = new Date(Date.now() - sinceDays * 86400_000).toISOString();

        // 1. Cibler les users
        const { data: prefs, error: prefsErr } = await (supabaseAdmin as any)
          .from("notification_preferences")
          .select("user_id, tenant_id, email_enabled, digest_frequency")
          .eq("digest_frequency", frequency)
          .eq("email_enabled", true);

        if (prefsErr) {
          return new Response(JSON.stringify({ error: prefsErr.message }), { status: 500 });
        }

        const targets = (prefs ?? []) as UserRow[];
        if (targets.length === 0) {
          return Response.json({ ok: true, processed: 0, frequency });
        }

        // Hydrater email/nom
        const userIds = targets.map((t) => t.user_id);
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id, email, full_name")
          .in("id", userIds);
        const profMap = new Map<string, { email: string | null; full_name: string | null }>();
        ((profiles as Array<{ id: string; email: string | null; full_name: string | null }>) ?? []).forEach((p) => {
          profMap.set(p.id, { email: p.email, full_name: p.full_name });
        });

        let processed = 0;
        let queued = 0;
        const errors: string[] = [];

        for (const t of targets) {
          const prof = profMap.get(t.user_id);
          if (!prof?.email) continue;

          // Notifications non lues + récentes
          const { data: notifs } = await supabaseAdmin
            .from("notifications")
            .select("id, kind, title, body, link, created_at")
            .eq("user_id", t.user_id)
            .eq("tenant_id", t.tenant_id)
            .gte("created_at", sinceIso)
            .is("read_at", null)
            .order("created_at", { ascending: false })
            .limit(50);

          const items = (notifs as Notif[]) ?? [];
          if (items.length === 0) {
            await (supabaseAdmin as any).from("digest_runs").insert({
              user_id: t.user_id,
              tenant_id: t.tenant_id,
              frequency,
              items_count: 0,
              status: "skipped",
            });
            processed++;
            continue;
          }

          const subject = `[JurisAI] Récap ${frequency === "weekly" ? "hebdo" : "du jour"} — ${items.length} action${items.length > 1 ? "s" : ""}`;
          const html = renderDigestHtml(prof.full_name ?? prof.email, items, frequency);
          const text = renderDigestText(items);

          const { error: queueErr } = await (supabaseAdmin as any).from("email_queue").insert({
            tenant_id: t.tenant_id,
            recipient_user_id: t.user_id,
            recipient_email: prof.email,
            template_key: `digest_${frequency}`,
            subject,
            body_html: html,
            body_text: text,
            metadata: { frequency, items_count: items.length },
          });

          if (queueErr) {
            errors.push(`${t.user_id}: ${queueErr.message}`);
            await (supabaseAdmin as any).from("digest_runs").insert({
              user_id: t.user_id,
              tenant_id: t.tenant_id,
              frequency,
              items_count: items.length,
              status: "failed",
              error: queueErr.message,
            });
          } else {
            queued++;
            await (supabaseAdmin as any).from("digest_runs").insert({
              user_id: t.user_id,
              tenant_id: t.tenant_id,
              frequency,
              items_count: items.length,
              status: "queued",
            });
          }
          processed++;
        }

        return Response.json({
          ok: true,
          frequency,
          processed,
          queued,
          errors: errors.slice(0, 10),
        });
      },
    },
  },
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function renderDigestHtml(name: string, items: Notif[], frequency: string) {
  const period = frequency === "weekly" ? "cette semaine" : "aujourd'hui";
  const rows = items
    .map(
      (n) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #eee;vertical-align:top">
          <div style="font-weight:600;color:#111;font-size:14px">${escapeHtml(n.title)}</div>
          ${n.body ? `<div style="color:#555;font-size:13px;margin-top:4px;line-height:1.5">${escapeHtml(n.body)}</div>` : ""}
          ${n.link ? `<div style="margin-top:6px"><a href="${escapeHtml(n.link)}" style="color:#2563eb;font-size:13px">Ouvrir →</a></div>` : ""}
        </td>
      </tr>`,
    )
    .join("");
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:auto;padding:24px;color:#111">
    <h2 style="margin:0 0 8px">Bonjour ${escapeHtml(name)},</h2>
    <p style="color:#444;line-height:1.5;margin:0 0 16px">Voici votre récapitulatif JurisAI ${period}. ${items.length} élément${items.length > 1 ? "s" : ""} à traiter.</p>
    <table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="color:#888;font-size:12px">Vous recevez cet email selon vos préférences (${frequency === "weekly" ? "hebdomadaire" : "quotidien"}). Modifiez-les dans Réglages → Notifications.</p>
  </div>`;
}

function renderDigestText(items: Notif[]) {
  return items.map((n) => `• ${n.title}${n.body ? `\n  ${n.body}` : ""}${n.link ? `\n  ${n.link}` : ""}`).join("\n\n");
}
