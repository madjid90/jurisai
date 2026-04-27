// GET /api/public/v1/deadlines — upcoming deadlines for the tenant
// POST /api/public/v1/deadlines — create a new deadline (scope: write)
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authenticateApiKey,
  requireScope,
  jsonResponse,
  errorResponse,
  logApiAudit,
  ApiError,
} from "@/server/api-auth.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const createSchema = z.object({
  dossier_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  due_at: z.string().datetime(),
  notes: z.string().trim().max(1000).optional().nullable(),
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

          const { data, error } = await (supabaseAdmin as any)
            .from("deadlines")
            .select("id, dossier_id, title, due_at, completed, notes, created_at")
            .eq("tenant_id", ctx.tenantId)
            .order("due_at", { ascending: true })
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
          if (!parsed.success) {
            throw new ApiError(400, "Invalid body: " + parsed.error.message);
          }

          // Ensure dossier belongs to the tenant
          const { data: dossier } = await (supabaseAdmin as any)
            .from("dossiers")
            .select("id")
            .eq("id", parsed.data.dossier_id)
            .eq("tenant_id", ctx.tenantId)
            .maybeSingle();
          if (!dossier) throw new ApiError(404, "Dossier not found");

          const { data, error } = await (supabaseAdmin as any)
            .from("deadlines")
            .insert({
              tenant_id: ctx.tenantId,
              dossier_id: parsed.data.dossier_id,
              title: parsed.data.title,
              due_at: parsed.data.due_at,
              notes: parsed.data.notes ?? null,
            })
            .select("id, dossier_id, title, due_at, completed, notes, created_at")
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
