import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireAdmin(userId: string) {
  const { data: profile } = await supabaseAdmin
    .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  const tenantId = (profile as { tenant_id: string | null } | null)?.tenant_id;
  if (!tenantId) throw new Error("No tenant");
  const { data: role } = await supabaseAdmin
    .from("user_roles").select("role")
    .eq("user_id", userId).eq("tenant_id", tenantId).eq("role", "admin").maybeSingle();
  if (!role) throw new Error("Forbidden — admin only");
  return tenantId;
}

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
      user_agent: string | null; metadata: Record<string, unknown>;
      created_at: string; user_id: string | null; api_key_id: string | null;
    }>;
  });
