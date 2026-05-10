// GET /api/public/v1/deadlines — upcoming deadlines (table: dossier_deadlines)
// POST /api/public/v1/deadlines — create a new deadline (scope: write)
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authenticateApiKey, requireScope, jsonResponse, errorResponse, logApiAudit, ApiError,
} from "@/server/api-auth.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const createSchema = z.object({
  dossier_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  due_date: z.string().datetime(),
  description: z.string().trim().max(1000).optional().nullable(),
});

export const Route = createFileRoute("/api/public/v1/deadlines")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await authenticateApiKey(request);
          requireScope(ctx, "read");

          const url = new URL(request.url);
          const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

          const { data, error } = await supabaseAdmin
            .from("dossier_deadlines")
            .select("id, dossier_id, title, due_date, completed, completed_at, description, created_at")
            .eq("tenant_id", ctx.tenantId)
            .order("due_date", { ascending: true })
            .limit(limit);

          if (error) throw new Error(error.message);

          await logApiAudit(ctx, request, "api.deadlines.list", "deadline", null, {
            returned: data?.length ?? 0,
          });

          return jsonResponse({ data: data ?? [], limit });
        } catch (e) {
          return errorResponse(e);
        }
      },
      POST: async ({ request }) => {
        try {
          const ctx = await authenticateApiKey(request);
          requireScope(ctx, "write");

          const body = await request.json().catch(() => null);
          const parsed = createSchema.safeParse(body);
          if (!parsed.success) throw new ApiError(400, "Invalid body: " + parsed.error.message);

          const { data: dossier } = await supabaseAdmin
            .from("dossiers")
            .select("id, created_by")
            .eq("id", parsed.data.dossier_id)
            .eq("tenant_id", ctx.tenantId)
            .maybeSingle();
          if (!dossier) throw new ApiError(404, "Dossier not found");

          const { data, error } = await supabaseAdmin
            .from("dossier_deadlines")
            .insert({
              tenant_id: ctx.tenantId,
              dossier_id: parsed.data.dossier_id,
              title: parsed.data.title,
              due_date: parsed.data.due_date,
              description: parsed.data.description ?? null,
              created_by: dossier.created_by, // Attribute to dossier owner (no user context for API key)
            })
            .select("id, dossier_id, title, due_date, completed, description, created_at")
            .single();
          if (error) throw new Error(error.message);

          await logApiAudit(ctx, request, "api.deadlines.create", "deadline", data.id, {
            dossier_id: parsed.data.dossier_id,
          });

          return jsonResponse({ data }, 201);
        } catch (e) {
          return errorResponse(e);
        }
      },
    },
  },
});
