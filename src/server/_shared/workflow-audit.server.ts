// Helper d'audit immuable pour les workflows (rétention 10 ans).
// Toute action sensible (génération IA, validation, rejet, blocage, exécution
// d'étape avec action sensible…) DOIT passer par logWorkflowAudit.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WorkflowAuditAction =
  | "workflow.generated"
  | "workflow.cache_hit"
  | "workflow.scored"
  | "workflow.auto_validated"
  | "workflow.pending_review"
  | "workflow.human_validated"
  | "workflow.rejected"
  | "workflow.published"
  | "workflow.executed"
  | "workflow.step_completed"
  | "workflow.sensitive_action_blocked"
  | "workflow.sensitive_action_authorized"
  | "workflow.consensus_disagreement"
  | "workflow.rerag_failed";

export async function logWorkflowAudit(opts: {
  tenantId: string;
  userId?: string | null;
  workflowDefinitionId?: string | null;
  workflowInstanceId?: string | null;
  action: WorkflowAuditAction;
  actorRole?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any).from("workflow_audit_log").insert({
      tenant_id: opts.tenantId,
      user_id: opts.userId ?? null,
      workflow_definition_id: opts.workflowDefinitionId ?? null,
      workflow_instance_id: opts.workflowInstanceId ?? null,
      action: opts.action,
      actor_role: opts.actorRole ?? null,
      before_state: opts.beforeState ?? null,
      after_state: opts.afterState ?? null,
      metadata: opts.metadata ?? {},
      ip_address: opts.ipAddress ?? null,
      user_agent: opts.userAgent ?? null,
    });
  } catch (e) {
    // Audit ne doit jamais bloquer le flux métier
    console.warn("[workflow-audit] insert failed:", (e as Error).message);
  }
}
