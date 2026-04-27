// GET /api/public/v1/clients — list CRM clients
// Auth: Bearer <api_key> (scope: read)
import { createFileRoute } from "@tanstack/react-router";
import {
  authenticateApiKey,
  requireScope,
  jsonResponse,
  errorResponse,
  logApiAudit,
} from "@/server/api-auth.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/v1/clients")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await authenticateApiKey(request);
          requireScope(ctx, "read");

          const url = new URL(request.url);
          const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
          const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

          const { data, error, count } = await (supabaseAdmin as any)
            .from("clients")
            .select("id, name, email, phone, company, created_at, updated_at", {
              count: "exact",
            })
            .eq("tenant_id", ctx.tenantId)
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

          if (error) throw new Error(error.message);

          await logApiAudit(ctx, request, "api.clients.list", "client", null, {
            returned: data?.length ?? 0,
          });

          return jsonResponse({ data: data ?? [], total: count ?? 0, limit, offset });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },
  },
});
