// Validations hiérarchiques — UI dédiée pour DRH/manager/admin qui doivent
// approuver ou refuser une action préparée par un autre user (ou par l'agent).
//
// Vision JurisAI : "service juridique interne" = workflow où le junior prépare,
// le sénior valide. Ces server fns alimentent la page /validations.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";

// ─── Liste des validations à faire pour le user courant ────────────────────

export const listPendingValidations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        scope: z.enum(["mine", "tenant"]).optional().default("mine"),
        limit: z.number().int().min(1).max(100).optional().default(50),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;

    let q = sb
      .from("validation_requests")
      .select(
        "id, dossier_id, requested_by, assigned_to, subject_type, subject_id, comment, status, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.scope === "mine") q = q.eq("assigned_to", userId);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const items = (rows ?? []) as Array<{
      id: string;
      dossier_id: string | null;
      requested_by: string;
      assigned_to: string | null;
      subject_type: string;
      subject_id: string | null;
      comment: string | null;
      status: string;
      created_at: string;
    }>;

    if (items.length === 0) return [];

    // Hydrate : titre du dossier + nom du demandeur
    const dossierIds = [...new Set(items.map((i) => i.dossier_id).filter(Boolean) as string[])];
    const userIds = [...new Set(items.map((i) => i.requested_by))];

    const [{ data: dossiers }, { data: profiles }] = await Promise.all([
      dossierIds.length
        ? sb.from("dossiers").select("id, title, category, risk_level").in("id", dossierIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? sb.from("profiles").select("id, full_name, email").in("id", userIds)
        : Promise.resolve({ data: [] }),
    ]);

    const dossierMap = new Map(
      ((dossiers ?? []) as Array<{ id: string; title: string; category: string; risk_level: string }>).map(
        (d) => [d.id, d],
      ),
    );
    const userMap = new Map(
      ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
        (p) => [p.id, p],
      ),
    );

    return items.map((i) => ({
      ...i,
      dossier: i.dossier_id ? dossierMap.get(i.dossier_id) ?? null : null,
      requested_by_user: userMap.get(i.requested_by) ?? null,
    }));
  });

// ─── Compteur léger pour le badge sidebar (Realtime peut le rafraîchir) ────

export const countPendingValidationsForMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;

    const { count, error } = await sb
      .from("validation_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .eq("assigned_to", userId);
    if (error) return 0;
    return count ?? 0;
  });

// ─── Approuver / refuser une validation ────────────────────────────────────

const decideSchema = z.object({
  validationId: z.string().uuid(),
  approved: z.boolean(),
  comment: z.string().max(2000).optional(),
});

// Logique pure extraite — testable sans la couche TanStack Start.
// La server fn ci-dessous se contente d'appeler ce core.
export async function decideValidationCore(
  input: { validationId: string; approved: boolean; comment?: string },
  ctx: { userId: string; tenantId: string },
): Promise<{ ok: true; approved: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;

  // Contrôle de rôle : admin / juriste / manager peuvent valider
  const { data: roles } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("tenant_id", ctx.tenantId);
  const allowed = new Set(["admin", "admin_tenant", "super_admin", "juriste", "manager"]);
  const canValidate = ((roles ?? []) as Array<{ role: string }>).some((r) => allowed.has(r.role));
  if (!canValidate) {
    throw new Error(
      "Permission refusée : seuls les administrateurs, juristes ou managers peuvent valider une action.",
    );
  }

  // Récupère la demande
  const { data: v, error: getErr } = await sb
    .from("validation_requests")
    .select("id, dossier_id, subject_type, subject_id, requested_by, comment, status")
    .eq("id", input.validationId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (getErr || !v) throw new Error("Validation introuvable");
  if (v.status !== "pending") throw new Error("Validation déjà décidée");
  if (v.requested_by === ctx.userId) {
    throw new Error("Vous ne pouvez pas valider votre propre demande.");
  }

  // Update
  const { error } = await sb
    .from("validation_requests")
    .update({
      status: input.approved ? "approved" : "rejected",
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
      decision_comment: input.comment ?? null,
    })
    .eq("id", v.id);
  if (error) throw new Error(error.message);

  // Effets de bord : si la demande concerne un generated_document, on aligne son statut
  if (v.subject_type === "generated_document" && v.subject_id) {
    try {
      await sb
        .from("generated_documents")
        .update({ status: input.approved ? "validated" : "rejected" })
        .eq("id", v.subject_id)
        .eq("tenant_id", ctx.tenantId);
    } catch { /* noop */ }
  }

  // Timeline + notif au demandeur
  if (v.dossier_id) {
    await logTimelineEvent({
      tenantId: ctx.tenantId,
      dossierId: v.dossier_id,
      actorId: ctx.userId,
      eventType: input.approved ? "validation.approved" : "validation.rejected",
      title: `${input.approved ? "Validation approuvée" : "Validation refusée"}`,
      metadata: { validation_id: v.id, comment: input.comment ?? null },
    });
  }

  try {
    await sb.from("notifications").insert({
      user_id: v.requested_by,
      tenant_id: ctx.tenantId,
      kind: "action_requise",
      title: input.approved ? "Votre demande a été validée" : "Votre demande a été refusée",
      body: input.comment ?? null,
      link: v.dossier_id ? `/dossiers/${v.dossier_id}` : null,
      metadata: { validation_id: v.id },
    });
  } catch { /* noop */ }

  return { ok: true, approved: input.approved };
}

export const decideValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => decideSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    return decideValidationCore(data, { userId, tenantId });
  });
