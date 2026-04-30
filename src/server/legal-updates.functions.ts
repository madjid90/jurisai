// Mises à jour réglementaires (legal_updates) — vue tenant + actions.
//
// Différent de `legal_alerts` (alertes système). Ici : impact réglementaire
// transverse (RGPD, fiscal, commercial, social…) avec actions concrètes
// par tenant : rattacher à un dossier, planifier une mise à jour de doc,
// ignorer, marquer traité.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "./_shared/tenant.server";
import { logTimelineEvent } from "./_shared/timeline.server";
import { notifyUser } from "./notifications.functions";

// ─── Lister les mises à jour ─────────────────────────────────────────────────

export const listLegalUpdates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        domain: z.string().optional(),
        urgency: z.enum(["low", "normal", "high", "critical"]).optional(),
        limit: z.number().min(1).max(100).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    let q = supabaseAdmin
      .from("legal_updates")
      .select(
        "id, domain, title, summary, urgency, publication_date, effective_date, who_is_concerned, practical_impact, recommended_actions, source_url, impacted_document_types, impacted_workflow_slugs, created_at",
      )
      .order("publication_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);

    if (data.domain) q = q.eq("domain", data.domain);
    if (data.urgency) q = q.eq("urgency", data.urgency);

    const { data: updates, error } = await q;
    if (error) throw new Error(error.message);

    // Statut tenant : action déjà créée ?
    const ids = (updates ?? []).map((u: any) => u.id);
    const actionMap = new Map<string, { status: string; action_type: string }[]>();
    if (ids.length > 0) {
      const { data: actions } = await supabaseAdmin
        .from("legal_update_actions")
        .select("legal_update_id, status, action_type")
        .eq("tenant_id", tenantId)
        .in("legal_update_id", ids);
      for (const a of (actions ?? []) as Array<{ legal_update_id: string; status: string; action_type: string }>) {
        const arr = actionMap.get(a.legal_update_id) ?? [];
        arr.push({ status: a.status, action_type: a.action_type });
        actionMap.set(a.legal_update_id, arr);
      }
    }

    return (updates ?? []).map((u: any) => ({ ...u, tenant_actions: actionMap.get(u.id) ?? [] }));
  });

// ─── Créer une action sur une mise à jour (par tenant) ───────────────────────

export const createLegalUpdateAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        legalUpdateId: z.string().uuid(),
        actionType: z.enum(["review", "update_document", "update_workflow", "create_dossier", "ignore", "delegate"]),
        relatedDossierId: z.string().uuid().nullable().optional(),
        assignedTo: z.string().uuid().nullable().optional(),
        notes: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    const { data: row, error } = await (supabaseAdmin as any)
      .from("legal_update_actions")
      .insert({
        tenant_id: tenantId,
        legal_update_id: data.legalUpdateId,
        action_type: data.actionType,
        related_dossier_id: data.relatedDossierId ?? null,
        assigned_to: data.assignedTo ?? null,
        triggered_by: userId,
        status: data.actionType === "ignore" ? "completed" : "pending",
        metadata: data.notes ? { notes: data.notes } : {},
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Timeline si rattaché à un dossier
    if (data.relatedDossierId) {
      const { data: upd } = await supabaseAdmin
        .from("legal_updates")
        .select("title, domain, urgency")
        .eq("id", data.legalUpdateId)
        .maybeSingle();
      const u = upd as { title: string; domain: string; urgency: string } | null;
      await logTimelineEvent({
        tenantId,
        dossierId: data.relatedDossierId,
        actorId: userId,
        eventType: "legal_update_linked",
        title: `Mise à jour réglementaire rattachée : ${u?.title ?? ""}`,
        description: `Domaine ${u?.domain ?? "?"} · Action: ${data.actionType}`,
        metadata: { legal_update_id: data.legalUpdateId, action_type: data.actionType, urgency: u?.urgency },
      });
    }

    // Notifier l'assigné (le cas échéant)
    if (data.assignedTo && data.assignedTo !== userId) {
      const { data: upd } = await supabaseAdmin
        .from("legal_updates")
        .select("title")
        .eq("id", data.legalUpdateId)
        .maybeSingle();
      await notifyUser({
        userId: data.assignedTo,
        tenantId,
        kind: "action_requise",
        title: `Action requise : ${(upd as any)?.title ?? "mise à jour réglementaire"}`,
        body: `Vous avez été assigné à : ${data.actionType}.`,
        link: `/veille`,
        metadata: { legal_update_id: data.legalUpdateId, action_id: row.id },
      });
    }

    return row;
  });

// ─── Mettre à jour le statut d'une action ────────────────────────────────────

export const updateLegalUpdateActionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        actionId: z.string().uuid(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    const update: Record<string, unknown> = { status: data.status, updated_at: new Date().toISOString() };
    if (data.status === "completed") update.completed_at = new Date().toISOString();

    const { error } = await (supabaseAdmin as any)
      .from("legal_update_actions")
      .update(update)
      .eq("id", data.actionId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
