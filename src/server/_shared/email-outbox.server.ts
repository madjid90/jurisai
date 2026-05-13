// LOT 11 — Email outbox helpers + worker.
//
// On enfile les emails dans `email_outbox` (au lieu d'appeler un provider en
// chemin chaud). Un worker périodique (cron pg_cron → /api/public/cron/email-worker)
// dépile par batch et envoie via le provider configuré (resend / smtp / ...).
//
// Ici, on ne dépend d'aucun provider concret : `sendEmail` est un point
// d'extension. Si aucune env var n'est configurée, l'envoi est marqué comme
// `failed` (loggé) mais l'enqueue reste fonctionnel.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EnqueueEmailInput = {
  tenantId?: string | null;
  userId?: string | null;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  template?: string;
  templateData?: Record<string, unknown>;
};

export async function enqueueEmail(input: EnqueueEmailInput): Promise<string | null> {
  if (!input.to || !input.subject) return null;
  const { data, error } = await supabaseAdmin
    .from("email_outbox")
    .insert([
      {
        tenant_id: input.tenantId ?? null,
        user_id: input.userId ?? null,
        to_email: input.to,
        subject: input.subject.slice(0, 500),
        body_html: input.html ?? null,
        body_text: input.text ?? null,
        template: input.template ?? null,
        template_data: (input.templateData ?? {}) as never,
      },
    ])
    .select("id")
    .single();
  if (error) {
    console.error("[email_outbox] enqueue failed", error);
    return null;
  }
  return (data as { id: string }).id;
}

type OutboxRow = {
  id: string;
  to_email: string;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  template: string | null;
  template_data: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
};

/**
 * Hook d'envoi réel — laissé volontairement minimal (provider à brancher).
 * Retourne true si envoyé, sinon throw une erreur explicite.
 */
async function sendEmail(row: OutboxRow): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "JurisAI <notifications@jurisai.fr>";

  const body: Record<string, unknown> = {
    from: fromEmail,
    to: [row.to_email],
    subject: row.subject,
  };

  if (row.body_html) body.html = row.body_html;
  else if (row.body_text) body.text = row.body_text;
  else body.text = row.subject; // Fallback minimal

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${errText.slice(0, 500)}`);
  }

  return true;
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

/**
 * Worker : prend un lot d'emails pending dont next_attempt_at <= now()
 * et tente de les envoyer. Retourne un résumé.
 */
export async function processEmailBatch(limit = 20): Promise<{
  picked: number;
  sent: number;
  failed: number;
  dead: number;
}> {
  const now = new Date().toISOString();
  const { data: rows } = await supabaseAdmin
    .from("email_outbox")
    .select("id, to_email, subject, body_html, body_text, template, template_data, attempts, max_attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", now)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  const items = (rows ?? []) as OutboxRow[];
  if (items.length === 0) return { picked: 0, sent: 0, failed: 0, dead: 0 };

  // Marque sending (best-effort, batch)
  await supabaseAdmin
    .from("email_outbox")
    .update({ status: "sending" })
    .in("id", items.map((r) => r.id));

  const results = await Promise.allSettled(items.map((row) => sendEmail(row)));

  let sent = 0, failed = 0, dead = 0;
  await Promise.allSettled(
    results.map(async (res, i) => {
      const row = items[i];
      if (res.status === "fulfilled" && res.value) {
        sent += 1;
        await supabaseAdmin
          .from("email_outbox")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", row.id);
      } else {
        const err = res.status === "rejected" ? String(res.reason?.message ?? res.reason) : "send_returned_false";
        const newAttempts = row.attempts + 1;
        if (newAttempts >= row.max_attempts) {
          dead += 1;
          await supabaseAdmin
            .from("email_outbox")
            .update({ status: "dead", attempts: newAttempts, last_error: err.slice(0, 1000) })
            .eq("id", row.id);
        } else {
          failed += 1;
          const backoff = BACKOFF_MS[Math.min(newAttempts - 1, BACKOFF_MS.length - 1)];
          const next = new Date(Date.now() + backoff).toISOString();
          await supabaseAdmin
            .from("email_outbox")
            .update({
              status: "pending",
              attempts: newAttempts,
              next_attempt_at: next,
              last_error: err.slice(0, 1000),
            })
            .eq("id", row.id);
        }
      }
    }),
  );

  return { picked: items.length, sent, failed, dead };
}
