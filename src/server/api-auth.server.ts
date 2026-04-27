// Server-only helper used by REST routes under /api/public/v1/*
// Authenticates a request using a tenant API key (Bearer jak_xxx_xxx)
// and writes an audit_log entry.

import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ApiAuthContext = {
  apiKeyId: string;
  tenantId: string;
  scopes: string[];
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function authenticateApiKey(request: Request): Promise<ApiAuthContext> {
  const auth = request.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(jak_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+)$/);
  if (!m) throw new ApiError(401, "Missing or malformed API key");

  const fullKey = m[1];
  const keyHash = createHash("sha256").update(fullKey).digest("hex");

  const { data, error } = await (supabaseAdmin as any).rpc("validate_api_key", {
    _key_hash: keyHash,
  });
  if (error) throw new ApiError(500, "Auth backend error");
  const row = (data ?? [])[0] as
    | { api_key_id: string; tenant_id: string; scopes: string[] }
    | undefined;
  if (!row) throw new ApiError(401, "Invalid or revoked API key");

  return {
    apiKeyId: row.api_key_id,
    tenantId: row.tenant_id,
    scopes: row.scopes ?? [],
  };
}

export function requireScope(ctx: ApiAuthContext, scope: "read" | "write") {
  if (!ctx.scopes.includes(scope)) {
    throw new ApiError(403, `Missing scope: ${scope}`);
  }
}

export async function logApiAudit(
  ctx: ApiAuthContext,
  request: Request,
  action: string,
  resource_type: string | null,
  resource_id: string | null,
  metadata: Record<string, unknown> = {},
) {
  try {
    await (supabaseAdmin as any).from("audit_logs").insert({
      tenant_id: ctx.tenantId,
      api_key_id: ctx.apiKeyId,
      action,
      resource_type,
      resource_id,
      ip_address:
        request.headers.get("cf-connecting-ip") ??
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        null,
      user_agent: request.headers.get("user-agent"),
      metadata,
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return jsonResponse({ error: err.message }, err.status);
  }
  console.error("API unhandled error:", err);
  return jsonResponse({ error: "Internal error" }, 500);
}
