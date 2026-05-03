// Server function utilisée par les modales agent pour créer une validation humaine
// hors du flux outil (ex : utilisateur qui clique "Demander validation" depuis AgentResultCard).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "./_shared/tenant.server";
import { logTimelineEvent } from "./_shared/timeline.server";

export const createAgentValidationRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        action_type: z.string().min(1).max(120),
        rule_kind: z.string().min(1).max(80),
        roles: z.array(z.string()).min(1).max(8),
        message: z.string().max(2000).optional(),
        sla_days: z.number().int().min(1).max(60).default(2),
        dossier_id: z.string().uuid().optional(),
        agent_run_id: z.string().uuid().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;

    // Cherche un destinataire dans le tenant (priorise les rôles demandés, sinon admin).
    const { data: candidates } = await sb
      .from("user_roles")
      .select("user_id, role")
      .eq("tenant_id", tenantId);

    const wanted = new Set(data.roles);
    const match =
      (candidates ?? []).find((r: { role: string }) => wanted.has(r.role)) ??
      (candidates ?? []).find((r: { role: string }) =>
        ["admin", "admin_tenant", "super_admin"].includes(r.role),
      );
    const assigned_to = (match as { user_id: string } | undefined)?.user_id ?? userId;

    const dueAt = new Date(Date.now() + data.sla_days * 86400000).toISOString();

    const { data: row, error } = await sb
      .from("validation_requests")
      .insert({
        tenant_id: tenantId,
        dossier_id: data.dossier_id ?? null,
        requested_by: userId,
        assigned_to,
        subject_type: data.action_type,
        comment: data.message ?? null,
        status: "pending",
        due_at: dueAt,
        metadata: {
          source: "agent_modal",
          rule_kind: data.rule_kind,
          requested_roles: data.roles,
          agent_run_id: data.agent_run_id ?? null,
        },
      })
      .select("id, subject_type, status, due_at")
      .single();

    if (error) throw new Error(error.message);

    if (data.dossier_id) {
      await logTimelineEvent({
        tenantId,
        dossierId: data.dossier_id,
        actorId: userId,
        eventType: "validation.requested",
        title: `Validation demandée : ${data.action_type}`,
        metadata: {
          source: "agent_modal",
          validation_id: row.id,
          rule_kind: data.rule_kind,
        },
      });
    }

    return row as { id: string; subject_type: string; status: string; due_at: string };
  });
