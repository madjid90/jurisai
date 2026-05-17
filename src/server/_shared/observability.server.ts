// Helper pour transformer les console.warn / console.error en logs structurés
// observables côté admin via la RPC log_server_error.
//
// Usage :
//   await logErr({ fn: "workflows.advance", err: e, ctx: { workflowId, userId } });
//
// Best-effort : ne throw jamais (un fail de log ne doit pas casser le flux).

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
  try {
    const message = p.err instanceof Error ? p.err.message : String(p.err);
    const stack = p.err instanceof Error ? p.err.stack ?? null : null;
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
    // Best-effort : si le log échoue lui-même, console.error en dernier recours
    console.error(`[observability] log_server_error failed for ${p.fn}:`, e);
  }
}
