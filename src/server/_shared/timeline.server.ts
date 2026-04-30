// Helper centralisé pour insérer des événements dans la timeline du dossier.
// Utilise supabaseAdmin (bypass RLS) — l'autorisation est garantie par le contexte appelant
// qui a déjà résolu tenant_id via getTenantId().
//
// Convention event_type :
//   - dossier.created
//   - dossier.updated
//   - dossier.status_changed
//   - document.added
//   - document.deleted
//   - analysis.completed
//   - risk.detected
//   - validation.requested / validation.decided
//   - deadline.added / deadline.completed
//   - reminder.created
//   - workflow.advanced

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type TimelineEvent = {
  tenantId: string;
  dossierId: string;
  actorId: string | null;
  eventType: string;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logTimelineEvent(ev: TimelineEvent): Promise<void> {
  try {
    await supabaseAdmin.from("case_timeline_events").insert({
      tenant_id: ev.tenantId,
      dossier_id: ev.dossierId,
      actor_id: ev.actorId,
      event_type: ev.eventType,
      title: ev.title,
      description: ev.description ?? null,
      metadata: ev.metadata ?? {},
    });
  } catch (e) {
    // Non-bloquant : la timeline ne doit jamais casser une opération métier.
    console.error("[timeline] insert failed", ev.eventType, e);
  }
}
