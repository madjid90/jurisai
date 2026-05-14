// Server functions Dossier 360 : timeline, risques, validations, rappels.
// Toutes les écritures loggent un événement timeline pour le suivi.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";
import { notifyUser } from "@/server/_shared/notify.server";

// ─── Helpers ─────────────────────────────────────────────────────────────

async function ensureDossierAccess(userId: string, dossierId: string): Promise<string> {
  const tenantId = await getTenantId(userId);
  const { data } = await supabaseAdmin
    .from("dossiers")
    .select("id, tenant_id")
    .eq("id", dossierId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) throw new Error("Dossier introuvable ou accès refusé");
  return tenantId;
}

// ─── 360° GET : timeline + risques + validations + rappels ──────────────

export const getDossier360 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ dossierId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
    const { userId } = context as { userId: string };
    const tenantId = await ensureDossierAccess(userId, data.dossierId);

    const db = supabaseAdmin as unknown as { from: (t: string) => any };
    const [timeline, risks, validations, reminders, generatedDocs, workflows] = await Promise.all([
      supabaseAdmin
        .from("case_timeline_events")
        .select("id, event_type, title, description, metadata, occurred_at, actor_id")
        .eq("tenant_id", tenantId)
        .eq("dossier_id", data.dossierId)
        .order("occurred_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("identified_risks")
        .select("id, category, severity, title, description, legal_basis, mitigation, status, created_at, resolved_at")
        .eq("tenant_id", tenantId)
        .eq("dossier_id", data.dossierId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("validation_requests")
        .select("id, subject_type, subject_id, comment, status, requested_by, assigned_to, decided_at, decision_comment, created_at")
        .eq("tenant_id", tenantId)
        .eq("dossier_id", data.dossierId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("reminders")
        .select("id, title, body, remind_at, sent_at, dismissed_at, user_id, created_at")
        .eq("tenant_id", tenantId)
        .eq("dossier_id", data.dossierId)
        .order("remind_at", { ascending: true }),
      db
        .from("generated_documents")
        .select("id, title, status, output_format, template_id, created_at, validated_at, document_templates(name, category, risk_level)")
        .eq("tenant_id", tenantId)
        .eq("dossier_id", data.dossierId)
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("workflow_instances")
        .select("id, title, status, current_step_index, created_at, updated_at, completed_at, definition_id, workflow_definitions(slug, title, category, steps)")
        .eq("tenant_id", tenantId)
        .eq("dossier_id", data.dossierId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    // Agréger les sources juridiques citées dans le dossier (timeline + risques)
    type SourceRef = { citation: string; count: number; lastSeen: string };
    const sourceMap = new Map<string, SourceRef>();
    const addSource = (raw: unknown, when: string) => {
      if (!raw) return;
      const cite = typeof raw === "string" ? raw : (raw as { citation?: string; reference?: string; ref?: string }).citation
        ?? (raw as { reference?: string }).reference
        ?? (raw as { ref?: string }).ref;
      if (!cite || typeof cite !== "string") return;
      const key = cite.trim();
      if (!key) return;
      const cur = sourceMap.get(key);
      if (cur) {
        cur.count += 1;
        if (when > cur.lastSeen) cur.lastSeen = when;
      } else {
        sourceMap.set(key, { citation: key, count: 1, lastSeen: when });
      }
    };
    for (const ev of (timeline.data ?? []) as any[]) {
      const md = ev.metadata as { sources?: unknown[]; citations?: unknown[]; legal_basis?: unknown[] } | null;
      const arr = md?.sources ?? md?.citations ?? md?.legal_basis;
      if (Array.isArray(arr)) arr.forEach((s) => addSource(s, ev.occurred_at as string));
    }
    for (const r of (risks.data ?? []) as any[]) {
      const lb = r.legal_basis as unknown[] | unknown;
      if (Array.isArray(lb)) lb.forEach((s) => addSource(s, r.created_at as string));
      else if (lb) addSource(lb, r.created_at as string);
    }
    const sources = Array.from(sourceMap.values()).sort((a, b) => b.count - a.count);

    return {
      timeline: timeline.data ?? [],
      risks: risks.data ?? [],
      validations: validations.data ?? [],
      reminders: reminders.data ?? [],
      generatedDocuments: generatedDocs.data ?? [],
      workflows: workflows.data ?? [],
      sources,
    };
    } catch (err) {
      console.error("[getDossier360]", err);
      throw new Error("Impossible de récupérer la vue 360° du dossier");
    }
  });

// ─── Risques ─────────────────────────────────────────────────────────────

export const createRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        dossierId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        severity: z.enum(["low", "medium", "high", "critical"]),
        category: z.string().trim().max(60).optional(),
        description: z.string().trim().max(2000).optional(),
        legalBasis: z.string().trim().max(500).optional(),
        mitigation: z.string().trim().max(1000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      const { userId } = context as { userId: string };
      const tenantId = await ensureDossierAccess(userId, data.dossierId);

      const legal_basis = data.legalBasis ? [{ source: data.legalBasis }] : [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error } = await supabaseAdmin
        .from("identified_risks")
        .insert({
          tenant_id: tenantId,
          dossier_id: data.dossierId,
          detected_by: userId,
          category: data.category ?? "general",
          severity: data.severity,
          title: data.title,
          description: data.description ?? null,
          legal_basis,
          mitigation: data.mitigation ?? null,
          status: "open",
        })
        .select("id, title, severity")
        .single();
      if (error) throw new Error(error.message);

      await logTimelineEvent({
        tenantId,
        dossierId: data.dossierId,
        actorId: userId,
        eventType: "risk.detected",
        title: `Risque identifié (${data.severity}) : ${data.title}`,
        metadata: { risk_id: row.id, severity: data.severity, source: "user" },
      });

      return { risk: row };
    } catch (err) {
      console.error("[createRisk]", err);
      throw new Error("Impossible de créer le risque");
    }
  });

export const updateRiskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        riskId: z.string().uuid(),
        // R64 (BUG-G10) — exiger le dossier porteur pour empêcher la
        // modification d'un risque d'un autre dossier du même tenant.
        dossierId: z.string().uuid(),
        status: z.enum(["open", "mitigating", "resolved", "accepted"]),
        mitigation: z.string().trim().max(1000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      const { userId } = context as { userId: string };
      const tenantId = await getTenantId(userId);

      const { data: existing } = await supabaseAdmin
        .from("identified_risks")
        .select("id, dossier_id, tenant_id, title")
        .eq("id", data.riskId)
        .eq("tenant_id", tenantId)
        .eq("dossier_id", data.dossierId)
        .maybeSingle();
      if (!existing) throw new Error("Risque introuvable");

      const patch: Record<string, unknown> = {
        status: data.status,
      };
      if (data.mitigation !== undefined) patch.mitigation = data.mitigation;
      if (data.status === "resolved") {
        patch.resolved_at = new Date().toISOString();
        patch.resolved_by = userId;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabaseAdmin as any)
        .from("identified_risks")
        .update(patch)
        .eq("id", data.riskId)
        .eq("tenant_id", tenantId)
        .eq("dossier_id", data.dossierId);
      if (error) throw new Error(error.message);

      await logTimelineEvent({
        tenantId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dossierId: (existing as any).dossier_id,
        actorId: userId,
        eventType: "risk.status_changed",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        title: `Risque "${(existing as any).title}" → ${data.status}`,
        metadata: { risk_id: data.riskId, status: data.status },
      });

      return { ok: true };
    } catch (err) {
      console.error("[updateRiskStatus]", err);
      throw new Error("Impossible de mettre à jour le statut du risque");
    }
  });

// ─── Validations ─────────────────────────────────────────────────────────

export const requestValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        dossierId: z.string().uuid(),
        subjectType: z.string().trim().min(1).max(60),
        subjectId: z.string().uuid().optional(),
        assignedTo: z.string().uuid().optional(),
        comment: z.string().trim().max(1000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      const { userId } = context as { userId: string };
      const tenantId = await ensureDossierAccess(userId, data.dossierId);

      let assignedTo = data.assignedTo;
      if (!assignedTo) {
        const { data: admins } = await supabaseAdmin
          .from("user_roles")
          .select("user_id")
          .eq("tenant_id", tenantId)
          .eq("role", "admin")
          .limit(1);
        assignedTo = (admins?.[0] as { user_id: string } | undefined)?.user_id ?? userId;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error } = await supabaseAdmin
        .from("validation_requests")
        .insert({
          tenant_id: tenantId,
          dossier_id: data.dossierId,
          requested_by: userId,
          assigned_to: assignedTo,
          subject_type: data.subjectType,
          subject_id: data.subjectId ?? null,
          comment: data.comment ?? null,
          status: "pending",
        })
        .select("id, subject_type, status, assigned_to")
        .single();
      if (error) throw new Error(error.message);

      await logTimelineEvent({
        tenantId,
        dossierId: data.dossierId,
        actorId: userId,
        eventType: "validation.requested",
        title: `Validation demandée : ${data.subjectType}`,
        metadata: { validation_id: row.id, assigned_to: assignedTo },
      });

      // W12 — Notification automatique au validateur assigné (in-app + email
      // selon préférences). On ne notifie pas le demandeur s'il est lui-même
      // assigné (cas dégradé : aucun admin trouvé).
      if (assignedTo && assignedTo !== userId) {
        const { data: dossier } = await supabaseAdmin
          .from("dossiers")
          .select("title")
          .eq("id", data.dossierId)
          .maybeSingle();
        const dossierTitle = (dossier as { title?: string } | null)?.title ?? "Dossier";
        await notifyUser({
          userId: assignedTo,
          tenantId,
          kind: "validation_requested",
          title: `Validation à traiter : ${data.subjectType}`,
          body: `${dossierTitle} — ${data.comment ?? "Aucun commentaire."}`,
          link: `/dossiers/${data.dossierId}?tab=validations`,
          metadata: {
            validation_id: row.id,
            dossier_id: data.dossierId,
            subject_type: data.subjectType,
            requested_by: userId,
          },
        }).catch(() => {
          /* la notification ne doit pas casser la création */
        });
      }

      return { validation: row };
    } catch (err) {
      console.error("[requestValidation]", err);
      throw new Error("Impossible de créer la demande de validation");
    }
  });

export const decideValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        validationId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        comment: z.string().trim().max(1000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      const { userId } = context as { userId: string };
      const tenantId = await getTenantId(userId);

      const { data: existing } = await supabaseAdmin
        .from("validation_requests")
        .select("id, dossier_id, tenant_id, assigned_to, subject_type, status")
        .eq("id", data.validationId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!existing) throw new Error("Demande introuvable");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ex = existing as any;
      if (ex.status && ex.status !== "pending") {
        throw new Error(`Cette demande a déjà été ${ex.status === "approved" ? "approuvée" : "rejetée"}.`);
      }
      if (ex.assigned_to !== userId) {
        const { data: role } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("tenant_id", tenantId)
          .eq("role", "admin")
          .maybeSingle();
        if (!role) throw new Error("Vous n'êtes pas habilité à décider de cette validation");
      }

      // W11 — UPDATE conditionnel sur status='pending' : bloque une seconde
      // décision concurrente (deux validateurs cliquent en même temps).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updated, error } = await supabaseAdmin
        .from("validation_requests")
        .update({
          status: data.decision,
          decided_at: new Date().toISOString(),
          decided_by: userId,
          decision_comment: data.comment ?? null,
        })
        .eq("id", data.validationId)
        .eq("status", "pending")
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) {
        throw new Error("Décision concurrente détectée — rechargez la demande.");
      }

      await logTimelineEvent({
        tenantId,
        dossierId: ex.dossier_id,
        actorId: userId,
        eventType: "validation.decided",
        title: `Validation ${data.decision === "approved" ? "approuvée" : "rejetée"} : ${ex.subject_type}`,
        metadata: { validation_id: data.validationId, decision: data.decision },
      });

      return { ok: true };
    } catch (err) {
      console.error("[decideValidation]", err);
      throw new Error("Impossible de traiter la décision de validation");
    }
  });

// ─── Rappels ─────────────────────────────────────────────────────────────

export const createReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        dossierId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().max(1000).optional(),
        remindAt: z.string().datetime(),
        targetUserId: z.string().uuid().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      const { userId } = context as { userId: string };
      const tenantId = await ensureDossierAccess(userId, data.dossierId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error } = await supabaseAdmin
        .from("reminders")
        .insert({
          tenant_id: tenantId,
          user_id: data.targetUserId ?? userId,
          created_by: userId,
          dossier_id: data.dossierId,
          title: data.title,
          body: data.body ?? null,
          remind_at: data.remindAt,
        })
        .select("id, title, remind_at")
        .single();
      if (error) throw new Error(error.message);

      await logTimelineEvent({
        tenantId,
        dossierId: data.dossierId,
        actorId: userId,
        eventType: "reminder.created",
        title: `Rappel : ${data.title}`,
        metadata: { reminder_id: row.id, remind_at: data.remindAt },
      });

      return { reminder: row };
    } catch (err) {
      console.error("[createReminder]", err);
      throw new Error("Impossible de créer le rappel");
    }
  });

export const dismissReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ reminderId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      const { userId } = context as { userId: string };
      const tenantId = await getTenantId(userId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabaseAdmin
        .from("reminders")
        .update({ dismissed_at: new Date().toISOString() })
        .eq("id", data.reminderId)
        .eq("tenant_id", tenantId)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    } catch (err) {
      console.error("[dismissReminder]", err);
      throw new Error("Impossible de masquer le rappel");
    }
  });
