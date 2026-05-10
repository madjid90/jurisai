// Capture structurée des erreurs des server functions.
// Insère dans `server_function_errors` via la fonction SECURITY DEFINER
// `log_server_error` (callable uniquement par service_role).
//
// Wrapper utilitaire `captureServerError` à utiliser dans les `catch` :
//   try { ... } catch (e) {
//     await captureServerError("agent.ask", { userId, tenantId }, e);
//     throw e;
//   }
//
// `withErrorMonitoring(fnName, fn)` enveloppe automatiquement.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ErrorContext = {
  userId?: string | null;
  tenantId?: string | null;
  severity?: "warn" | "error" | "critical";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extra?: Record<string, any>;
};

export async function captureServerError(
  functionName: string,
  context: ErrorContext,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err ?? "unknown");
  const stack = err instanceof Error ? err.stack ?? null : null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabaseAdmin.rpc("log_server_error", {
      _function_name: functionName,
      _user_id: context.userId ?? null,
      _tenant_id: context.tenantId ?? null,
      _error_message: message,
      _error_stack: stack,
      _context: context.extra ?? {},
      _severity: context.severity ?? "error",
    });
  } catch (logErr) {
    // Le logging ne doit jamais masquer l'erreur d'origine.
    console.error("[error-monitor] failed to log:", logErr, "original:", message);
  }
}

export function withErrorMonitoring<TArgs extends unknown[], TResult>(
  functionName: string,
  fn: (...args: TArgs) => Promise<TResult>,
  contextResolver?: (...args: TArgs) => ErrorContext,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    try {
      return await fn(...args);
    } catch (e) {
      const ctx = contextResolver ? contextResolver(...args) : {};
      await captureServerError(functionName, ctx, e);
      throw e;
    }
  };
}
