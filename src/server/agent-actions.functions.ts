// executeSuggestedAction — point d'entrée unifié pour exécuter les actions
// proposées par l'agent depuis le front-end.
//
// Lot 3 du plan refonte : remplace les `onRelaunch(label)` dispersés.
// Chaque type d'action est typé, validé Zod, et router vers la bonne logique.
// Toute action impliquant un dossier loggue un événement dans la timeline.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

// --- Schéma : 9 actions du spec ---------------------------------------------
const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("open_dossier"), dossier_id: z.string().uuid() }),
  z.object({
    type: z.literal("create_dossier"),
    title: z.string().min(1).max(200),
    category: z.string().optional(),
    description: z.string().optional(),
    risk_level: z.enum(["low", "medium", "high", "critical"]).optional(),
  }),
  z.object({
    type: z.literal("link_document"),
    document_id: z.string().uuid(),
    dossier_id: z.string().uuid(),
  }),
  z.object({
    type: z.literal("start_workflow"),
    definition_slug: z.string().min(1),
    dossier_id: z.string().uuid().optional(),
    title: z.string().optional(),
  }),
  z.object({
    type: z.literal("generate_document"),
    template_slug: z.string().min(1),
    dossier_id: z.string().uuid().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("create_reminder"),
    title: z.string().min(1).max(200),
    due_date: z.string(), // ISO date
    dossier_id: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal("validate_action"),
    validation_id: z.string().uuid(),
    approved: z.boolean(),
    comment: z.string().optional(),
  }),
  z.object({
    type: z.literal("assign_task"),
    title: z.string().min(1).max(200),
    assignee_id: z.string().uuid(),
    dossier_id: z.string().uuid(),
    due_date: z.string().optional(),
  }),
  z.object({
    type: z.literal("send_notification"),
    user_id: z.string().uuid(),
    title: z.string().min(1).max(200),
    body: z.string().optional(),
    link: z.string().optional(),
    kind: z.string().default("action_requise"),
  }),
]);

export type SuggestedActionInput = z.infer<typeof ActionSchema>;

export const executeSuggestedAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ActionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    switch (data.type) {
      // ---------------------------------------------------------- open_dossier
      case "open_dossier": {
        const { data: d, error } = await db
          .from("dossiers")
          .select("id, title")
          .eq("id", data.dossier_id)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (error || !d) throw new Error("Dossier introuvable");
        return { ok: true, redirect: `/dossiers/${d.id}` };
      }

      // -------------------------------------------------------- create_dossier
      case "create_dossier": {
        const { data: d, error } = await db
          .from("dossiers")
          .insert({
            tenant_id: tenantId,
            created_by: userId,
            title: data.title.slice(0, 200),
            description: data.description ?? null,
            category: data.category ?? "general",
            status: "open",
            risk_level: data.risk_level ?? "low",
          })
          .select("id, title, category")
          .single();
        if (error) throw new Error(error.message);
        await logTimelineEvent({
          tenantId,
          dossierId: d.id,
          actorId: userId,
          eventType: "dossier.created",
          title: `Dossier créé : ${d.title}`,
          metadata: { source: "result_panel", category: d.category },
        });
        return { ok: true, dossier: d, redirect: `/dossiers/${d.id}` };
      }

      // ---------------------------------------------------------- link_document
      case "link_document": {
        const { error } = await db.from("document_links").insert({
          tenant_id: tenantId,
          document_id: data.document_id,
          dossier_id: data.dossier_id,
          status: "confirmed",
          link_method: "manual",
          confidence: 1,
          confirmed_by: userId,
          confirmed_at: new Date().toISOString(),
        });
        if (error && !String(error.message).includes("duplicate")) {
          throw new Error(error.message);
        }
        await logTimelineEvent({
          tenantId,
          dossierId: data.dossier_id,
          actorId: userId,
          eventType: "document.linked",
          title: "Document rattaché au dossier",
          metadata: { document_id: data.document_id, source: "result_panel" },
        });
        return { ok: true };
      }

      // --------------------------------------------------------- start_workflow
      // P0.4 : bloque le lancement direct si le workflow est sensible / non
      // validé. La demande est rerouter vers une demande de validation humaine.
      case "start_workflow": {
        const { data: def, error: defErr } = await db
          .from("workflow_definitions")
          .select(
            "id, title, slug, status, lifecycle_status, requires_human_review, contains_sensitive_actions, sensitive_actions_detected",
          )
          .eq("slug", data.definition_slug)
          .maybeSingle();
        if (defErr || !def) throw new Error("Procédure introuvable");

        // Règles de blocage (cf. spec P0.4) — adaptées au schéma réel.
        const blockedReasons: string[] = [];
        if (def.requires_human_review) blockedReasons.push("révision humaine requise");
        if (def.contains_sensitive_actions) blockedReasons.push("actions sensibles détectées");
        if (def.lifecycle_status === "pending_human_review") blockedReasons.push("en attente de validation");
        if (def.lifecycle_status === "rejected") blockedReasons.push("procédure rejetée");
        if (def.status && def.status !== "active" && def.status !== "human_validated" && def.status !== "ai_validated_auto") {
          blockedReasons.push(`statut = ${def.status}`);
        }

        if (blockedReasons.length > 0) {
          // Crée une demande de validation au lieu de lancer.
          const { data: vr } = await db
            .from("validation_requests")
            .insert({
              tenant_id: tenantId,
              dossier_id: data.dossier_id ?? null,
              requested_by: userId,
              subject_type: "workflow_definition",
              subject_id: def.id,
              title: `Validation procédure : ${def.title}`,
              comment: `Lancement bloqué — ${blockedReasons.join(", ")}.`,
              status: "pending",
            })
            .select("id")
            .single();

          if (data.dossier_id) {
            await logTimelineEvent({
              tenantId,
              dossierId: data.dossier_id,
              actorId: userId,
              eventType: "workflow.blocked_pending_validation",
              title: `Procédure bloquée : ${def.title}`,
              metadata: {
                workflow_definition_id: def.id,
                validation_request_id: vr?.id,
                reasons: blockedReasons,
              },
            });
          }

          return {
            ok: false,
            requires_validation: true,
            reason: `Cette procédure nécessite une validation humaine avant lancement (${blockedReasons.join(", ")}).`,
            workflow_definition_id: def.id,
            validation_request_id: vr?.id ?? null,
          };
        }

        const { data: instance, error } = await db
          .from("workflow_instances")
          .insert({
            tenant_id: tenantId,
            definition_id: def.id,
            title: data.title ?? def.title,
            dossier_id: data.dossier_id ?? null,
            status: "in_progress", // P0.3 — statut harmonisé
            started_by: userId,
            current_step_index: 0,
            context: {},
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);

        if (data.dossier_id) {
          await logTimelineEvent({
            tenantId,
            dossierId: data.dossier_id,
            actorId: userId,
            eventType: "workflow.started",
            title: `Procédure lancée : ${def.title}`,
            metadata: { workflow_instance_id: instance.id, source: "result_panel" },
          });
        }
        return { ok: true, workflow_instance_id: instance.id, redirect: `/workflows/${instance.id}` };
      }


      // ------------------------------------------------------- generate_document
      case "generate_document": {
        const { data: tpl, error: tplErr } = await db
          .from("document_templates")
          .select("id, name, slug")
          .eq("slug", data.template_slug)
          .maybeSingle();
        if (tplErr || !tpl) throw new Error("Modèle introuvable");

        const { data: session, error } = await db
          .from("document_generation_sessions")
          .insert({
            tenant_id: tenantId,
            user_id: userId,
            template_id: tpl.id,
            dossier_id: data.dossier_id ?? null,
            status: "draft",
            scenario: "agent_suggestion",
            collected_data: data.context ?? {},
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);

        if (data.dossier_id) {
          await logTimelineEvent({
            tenantId,
            dossierId: data.dossier_id,
            actorId: userId,
            eventType: "document.generation.started",
            title: `Génération démarrée : ${tpl.name}`,
            metadata: { generation_session_id: session.id, source: "result_panel" },
          });
        }
        return { ok: true, generation_session_id: session.id };
      }

      // --------------------------------------------------------- create_reminder
      case "create_reminder": {
        const { data: r, error } = await db
          .from("reminders")
          .insert({
            tenant_id: tenantId,
            user_id: userId,
            dossier_id: data.dossier_id ?? null,
            created_by: userId,
            title: data.title,
            remind_at: data.due_date,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        if (data.dossier_id) {
          await logTimelineEvent({
            tenantId,
            dossierId: data.dossier_id,
            actorId: userId,
            eventType: "reminder.created",
            title: `Rappel créé : ${data.title}`,
            metadata: { reminder_id: r.id, remind_at: data.due_date, source: "result_panel" },
          });
        }
        return { ok: true, reminder_id: r.id };
      }

      // -------------------------------------------------------- validate_action
      case "validate_action": {
        // Contrôle de rôle : seuls admin / juriste / manager peuvent valider
        const { data: roles } = await db
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("tenant_id", tenantId);
        const allowed = new Set(["admin", "admin_tenant", "super_admin", "juriste", "manager"]);
        const canValidate = (roles ?? []).some((r: { role: string }) => allowed.has(r.role));
        if (!canValidate) {
          throw new Error(
            "Permission refusée : seuls les administrateurs, juristes ou managers peuvent valider une action.",
          );
        }

        const { data: v, error: getErr } = await db
          .from("validation_requests")
          .select("id, dossier_id, title, requested_by, assigned_to")
          .eq("id", data.validation_id)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (getErr || !v) throw new Error("Validation introuvable");

        // Empêche l'auto-validation : le demandeur ne peut pas approuver sa propre demande
        if (v.requested_by === userId) {
          throw new Error("Vous ne pouvez pas valider votre propre demande.");
        }

        const { error } = await db
          .from("validation_requests")
          .update({
            status: data.approved ? "approved" : "rejected",
            decided_by: userId,
            decided_at: new Date().toISOString(),
            decision_comment: data.comment ?? null,
          })
          .eq("id", v.id);
        if (error) throw new Error(error.message);

        if (v.dossier_id) {
          await logTimelineEvent({
            tenantId,
            dossierId: v.dossier_id,
            actorId: userId,
            eventType: data.approved ? "validation.approved" : "validation.rejected",
            title: `${data.approved ? "Validation approuvée" : "Validation refusée"} : ${v.title}`,
            metadata: { validation_id: v.id, source: "result_panel" },
          });
        }
        return { ok: true, approved: data.approved };
      }

      // ------------------------------------------------------------ assign_task
      case "assign_task": {
        const { data: t, error } = await db
          .from("dossier_tasks")
          .insert({
            tenant_id: tenantId,
            dossier_id: data.dossier_id,
            created_by: userId,
            assigned_to: data.assignee_id,
            title: data.title,
            due_date: data.due_date ?? null,
            status: "open",
            priority: "normal",
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);

        // Notifier l'assigné
        await db.from("notifications").insert({
          user_id: data.assignee_id,
          tenant_id: tenantId,
          kind: "action_requise",
          title: "Nouvelle tâche assignée",
          body: data.title,
          link: `/dossiers/${data.dossier_id}`,
          metadata: { task_id: t.id },
        });

        await logTimelineEvent({
          tenantId,
          dossierId: data.dossier_id,
          actorId: userId,
          eventType: "task.assigned",
          title: `Tâche assignée : ${data.title}`,
          metadata: { task_id: t.id, assignee_id: data.assignee_id, source: "result_panel" },
        });
        return { ok: true, task_id: t.id };
      }

      // ------------------------------------------------------ send_notification
      case "send_notification": {
        const { data: n, error } = await db
          .from("notifications")
          .insert({
            user_id: data.user_id,
            tenant_id: tenantId,
            kind: data.kind,
            title: data.title,
            body: data.body ?? null,
            link: data.link ?? null,
            metadata: { source: "result_panel" },
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        return { ok: true, notification_id: n.id };
      }
    }
  });
