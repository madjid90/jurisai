// Slack helper — calls the Lovable connector gateway.
// Server-only: imported dynamically from server functions.

import { LLM_API_KEY } from "@/server/_shared/constants.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

export async function postSlackMessage(channel: string, text: string, blocks?: unknown[]) {
  const LOVABLE_API_KEY = LLM_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  const SLACK_API_KEY = process.env.SLACK_API_KEY;
  if (!SLACK_API_KEY) throw new Error("Slack non connecté (SLACK_API_KEY manquant)");

  const res = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": SLACK_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(blocks ? { channel, text, blocks } : { channel, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.ok === false)) {
    throw new Error(`Slack API failed [${res.status}]: ${JSON.stringify(data)}`);
  }
  return data;
}

/** Best-effort Slack notification for a tenant. Never throws. */
export async function notifyTenantSlack(
  supabaseAdmin: any,
  tenantId: string,
  text: string,
): Promise<void> {
  try {
    if (!process.env.SLACK_API_KEY) return;
    const { data } = await supabaseAdmin
      .from("tenant_integrations")
      .select("slack_channel, slack_enabled")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!data?.slack_enabled || !data?.slack_channel) return;
    await postSlackMessage(data.slack_channel, text);
  } catch (err) {
    console.error("[slack] notifyTenantSlack failed:", err);
  }
}

/** Best-effort outbound webhook delivery for a tenant. Never throws. */
export async function dispatchWebhook(
  supabaseAdmin: any,
  tenantId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: hooks } = await supabaseAdmin
      .from("tenant_webhooks")
      .select("id, target_url, events, secret")
      .eq("tenant_id", tenantId).eq("active", true);
    const list = (hooks ?? []) as Array<{
      id: string; target_url: string; events: string[]; secret: string;
    }>;
    const matching = list.filter((h) => h.events.includes(event));
    if (matching.length === 0) return;

    const body = JSON.stringify({ event, tenant_id: tenantId, data: payload, sent_at: new Date().toISOString() });
    const { createHmac } = await import("crypto");

    await Promise.all(
      matching.map(async (h) => {
        const sig = createHmac("sha256", h.secret).update(body).digest("hex");
        let status = "delivered";
        let code: number | null = null;
        let errMsg: string | null = null;
        try {
          const r = await fetch(h.target_url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-JurisAI-Event": event,
              "X-JurisAI-Signature": `sha256=${sig}`,
            },
            body,
          });
          code = r.status;
          if (!r.ok) { status = "failed"; errMsg = `HTTP ${r.status}`; }
        } catch (e) {
          status = "failed";
          errMsg = e instanceof Error ? e.message : String(e);
        }
        await supabaseAdmin.from("webhook_deliveries").insert({
          webhook_id: h.id, tenant_id: tenantId, event, payload,
          status, response_code: code, error: errMsg,
        });
      }),
    );
  } catch (err) {
    console.error("[webhook] dispatchWebhook failed:", err);
  }
}
