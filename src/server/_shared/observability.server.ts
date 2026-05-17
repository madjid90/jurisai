// Helper pour transformer les console.warn / console.error en logs structurés
// observables côté admin via la RPC log_server_error + push optionnel vers Sentry.
//
// Usage :
//   await logErr({ fn: "workflows.advance", err: e, ctx: { workflowId, userId } });
//
// Best-effort : ne throw jamais (un fail de log ne doit pas casser le flux).
// Sentry : push HTTP direct (pas de SDK npm — portable Cloudflare Workers).
// Active si SENTRY_DSN env var défini.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LogErrParams = {
  fn: string;                      // ex: "workflows.advance", "rgpd.delete_account"
  err: unknown;                    // l'erreur attrapée
  userId?: string;
  tenantId?: string;
  ctx?: Record<string, unknown>;   // contexte structuré (IDs, params)
  severity?: "info" | "warn" | "error" | "critical";
};

export async function logErr(p: LogErrParams): Promise<void> {
  const message = p.err instanceof Error ? p.err.message : String(p.err);
  const stack = p.err instanceof Error ? p.err.stack ?? null : null;

  // 1. Push DB (RPC log_server_error)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    await sb.rpc("log_server_error", {
      _function_name: p.fn,
      _user_id: p.userId ?? null,
      _tenant_id: p.tenantId ?? null,
      _error_message: message.slice(0, 2000),
      _error_stack: stack ? stack.slice(0, 4000) : null,
      _context: p.ctx ?? {},
      _severity: p.severity ?? "warn",
    });
  } catch (e) {
    console.error(`[observability] log_server_error failed for ${p.fn}:`, e);
  }

  // 2. Push Sentry (best-effort, fire-and-forget)
  // Active uniquement si SENTRY_DSN env var défini.
  // Format minimal Sentry Store API : pas besoin de SDK npm.
  const dsn = process.env.SENTRY_DSN;
  if (dsn && (p.severity === "error" || p.severity === "critical")) {
    sendToSentry({ dsn, message, stack, fn: p.fn, ctx: p.ctx, severity: p.severity }).catch(() => {
      /* fire-and-forget */
    });
  }
}

// ─── Sentry HTTP client minimaliste (sans SDK npm) ──────────────────────────
type SentryPayload = {
  dsn: string;
  message: string;
  stack: string | null;
  fn: string;
  ctx?: Record<string, unknown>;
  severity: "info" | "warn" | "error" | "critical";
};

async function sendToSentry(p: SentryPayload): Promise<void> {
  try {
    // Parse DSN : https://<key>@<host>/<project_id>
    const m = p.dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
    if (!m) return;
    const [, key, host, projectId] = m;
    const url = `https://${host}/api/${projectId}/store/`;

    const event = {
      event_id: crypto.randomUUID().replace(/-/g, ""),
      timestamp: new Date().toISOString(),
      level: p.severity === "critical" ? "fatal" : p.severity === "error" ? "error" : "warning",
      logger: p.fn,
      platform: "node",
      message: p.message.slice(0, 2000),
      exception: p.stack
        ? {
            values: [
              { type: "Error", value: p.message.slice(0, 500), stacktrace: { frames: [{ filename: p.fn }] } },
            ],
          }
        : undefined,
      extra: p.ctx ?? {},
      environment: process.env.NODE_ENV ?? "production",
      release: process.env.SENTRY_RELEASE ?? "unknown",
    };

    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7,sentry_key=${key},sentry_client=jurisai/1.0`,
      },
      body: JSON.stringify(event),
    });
  } catch {
    /* fire-and-forget */
  }
}
