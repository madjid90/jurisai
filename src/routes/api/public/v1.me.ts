// GET /api/public/v1/me — info about the API key (sanity check)
import { createFileRoute } from "@tanstack/react-router";
import {
  authenticateApiKey,
  jsonResponse,
  errorResponse,
} from "@/server/api-auth.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/v1/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await authenticateApiKey(request);
          const { data: tenant } = await (supabaseAdmin as any)
            .from("tenants")
            .select("id, name, plan, idcc")
            .eq("id", ctx.tenantId)
            .maybeSingle();
          return jsonResponse({
            tenant,
            scopes: ctx.scopes,
            api_version: "v1",
          });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },
  },
});
