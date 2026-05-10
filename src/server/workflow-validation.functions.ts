// validateWorkflowStep — vérifie les conditions avant d'avancer dans une étape.
// Retourne {ok, blockers[], warnings[], missing_fields[], recommended_next_step}.
// Logique transverse : la définition d'étape est étendue avec champs optionnels
// (cf. STEP_SCHEMA in seeds). Aucune migration nécessaire — JSONB.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import { WORKFLOW_VALIDATOR_ROLES } from "@/server/_shared/workflow-roles.server";

export type ExtendedWorkflowStep = {
  key: string;
  title: string;
  description?: string;
  type?: "action" | "document" | "decision" | "wait" | "validation";
  required_data?: string[]; // clés à présent dans context
  documents_to_generate?: string[]; // slugs de templates
  legal_refs?: string[];
  risks?: Array<{ title: string; severity: "low" | "medium" | "high" | "critical" }>;
  validation_required?: boolean; // requiert un admin/manager pour valider
  reminder_days?: number; // si défini, créer un rappel automatique
  delay_days?: number;
  next_step_key?: string; // override pour parcours conditionnels
};

type ValidationResult = {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  missing_fields: string[];
  recommended_next_step: string | null;
  step?: ExtendedWorkflowStep;
};

export const validateWorkflowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        instanceId: z.string().uuid(),
        stepIndex: z.number().int().min(0),
        proposedData: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ValidationResult> => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    const { data: inst, error } = await supabaseAdmin
      .from("workflow_instances")
      .select("id, definition_id, context, current_step_index, dossier_id")
      .eq("id", data.instanceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inst) throw new Error("Instance introuvable");

    const { data: def } = await supabaseAdmin
      .from("workflow_definitions")
      .select("steps, title")
      .eq("id", (inst as any).definition_id)
      .maybeSingle();
    const steps = ((def as any)?.steps ?? []) as ExtendedWorkflowStep[];
    const step = steps[data.stepIndex];

    if (!step) {
      return {
        ok: false,
        blockers: [`Étape ${data.stepIndex} introuvable`],
        warnings: [],
        missing_fields: [],
        recommended_next_step: null,
      };
    }

    const ctx = { ...(((inst as any).context as Record<string, unknown>) ?? {}), ...(data.proposedData ?? {}) };
    const blockers: string[] = [];
    const warnings: string[] = [];
    const missing: string[] = [];

    // 1) Champs requis
    for (const key of step.required_data ?? []) {
      const v = ctx[key];
      if (v === undefined || v === null || v === "") missing.push(key);
    }
    if (missing.length > 0) {
      blockers.push(`Données manquantes : ${missing.join(", ")}`);
    }

    // 2) Risques élevés → warning
    for (const r of step.risks ?? []) {
      if (r.severity === "high" || r.severity === "critical") {
        warnings.push(`Risque ${r.severity} : ${r.title}`);
      }
    }

    // 3) Validation requise → vérifier rôle
    // BUG-W4 : on s'appuie sur la liste centralisée de rôles validateurs.
    if (step.validation_required) {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .in("role", [...WORKFLOW_VALIDATOR_ROLES]);
      if (!roles || roles.length === 0) {
        blockers.push("Cette étape nécessite la validation d'un admin, manager ou super_admin");
      }
    }

    // 4) Documents prévus → contrôle d'existence des templates
    for (const slug of step.documents_to_generate ?? []) {
      const { data: tpl } = await supabaseAdmin
        .from("document_templates")
        .select("id")
        .eq("slug", slug)
        .or(`is_public.eq.true,tenant_id.eq.${tenantId}`)
        .maybeSingle();
      if (!tpl) warnings.push(`Modèle de document indisponible : ${slug}`);
    }

    // 5) Étape suivante recommandée
    let nextKey: string | null = null;
    if (step.next_step_key) {
      nextKey = step.next_step_key;
    } else if (data.stepIndex + 1 < steps.length) {
      nextKey = steps[data.stepIndex + 1].key;
    }

    return {
      ok: blockers.length === 0,
      blockers,
      warnings,
      missing_fields: missing,
      recommended_next_step: nextKey,
      step,
    };
  });
