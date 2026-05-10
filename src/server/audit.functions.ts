import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
// S22 (audit) : un seul `requireAdmin`, centralisé dans `_shared/tenant.server.ts`.
import { requireAdmin } from "@/server/_shared/tenant.server";

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      action: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);

    let q = (supabaseAdmin as any)
      .from("audit_logs")
      .select("id, action, resource_type, resource_id, ip_address, user_agent, metadata, created_at, user_id, api_key_id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.action) q = q.eq("action", data.action);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      id: string; action: string; resource_type: string | null;
      resource_id: string | null; ip_address: string | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user_agent: string | null; metadata: Record<string, any>;
      created_at: string; user_id: string | null; api_key_id: string | null;
    }>;
  });
