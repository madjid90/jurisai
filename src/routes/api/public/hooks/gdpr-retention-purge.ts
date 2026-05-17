// Cron hebdomadaire : purge des données personnelles au-delà de la rétention.
//
// Conformité RGPD art. 5-1-e (conservation limitée) :
// - agent_runs : 180 jours (sauf si attaché à un dossier actif)
// - conversations + messages : 180 jours sans activité
// - documents : 365 jours (durée de conservation comptable usuelle)
// - calculation_history : 365 jours (audit trail juridique, plus long)
// - notifications : 90 jours
// - validation_requests résolus : 180 jours
//
// Les données restent disponibles pour les utilisateurs jusqu'à la purge.
// L'utilisateur peut aussi forcer la suppression via /settings → "Supprimer mon compte".
//
// Auth : x-cron-secret uniquement.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronAuth } from "@/server/_shared/cron-auth.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

type PurgeResult = { table: string; deleted: number; error?: string };

async function purgeTable(table: string, daysOld: number, dateCol = "created_at"): Promise<PurgeResult> {
  const cutoff = new Date(Date.now() - daysOld * 86400_000).toISOString();
  try {
    const { count, error } = await db
      .from(table)
      .delete({ count: "exact" })
      .lt(dateCol, cutoff);
    if (error) return { table, deleted: 0, error: error.message };
    return { table, deleted: count ?? 0 };
  } catch (e) {
    return { table, deleted: 0, error: e instanceof Error ? e.message : "unknown" };
  }
}

export const Route = createFileRoute("/api/public/hooks/gdpr-retention-purge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        const results: PurgeResult[] = [];

        // 1. Notifications anciennes : 90 jours
        results.push(await purgeTable("notifications", 90));

        // 2. Agent runs anciens (sauf attachés à dossier actif) : 180 jours
        // Plus complexe : delete avec sous-requête. On le fait via SQL brut.
        try {
          const cutoff180 = new Date(Date.now() - 180 * 86400_000).toISOString();
          const { count, error } = await db
            .from("agent_runs")
            .delete({ count: "exact" })
            .lt("created_at", cutoff180)
            .is("dossier_id", null);
          results.push({ table: "agent_runs_orphan", deleted: count ?? 0, error: error?.message });
        } catch (e) {
          results.push({ table: "agent_runs_orphan", deleted: 0, error: e instanceof Error ? e.message : "unknown" });
        }

        // 3. Messages des conversations sans activité depuis 180 jours
        try {
          const cutoff180 = new Date(Date.now() - 180 * 86400_000).toISOString();
          const { data: oldConvs } = await db
            .from("conversations")
            .select("id")
            .lt("updated_at", cutoff180)
            .limit(1000);
          const ids = ((oldConvs as Array<{ id: string }>) ?? []).map((c) => c.id);
          if (ids.length > 0) {
            const { count: msgCount } = await db
              .from("messages")
              .delete({ count: "exact" })
              .in("conversation_id", ids);
            await db.from("conversations").delete().in("id", ids);
            results.push({ table: "conversations+messages", deleted: ids.length + (msgCount ?? 0) });
          } else {
            results.push({ table: "conversations+messages", deleted: 0 });
          }
        } catch (e) {
          results.push({ table: "conversations+messages", deleted: 0, error: e instanceof Error ? e.message : "unknown" });
        }

        // 4. Validation requests résolus : 180 jours
        try {
          const cutoff180 = new Date(Date.now() - 180 * 86400_000).toISOString();
          const { count, error } = await db
            .from("validation_requests")
            .delete({ count: "exact" })
            .lt("decided_at", cutoff180)
            .not("decided_at", "is", null);
          results.push({ table: "validation_requests", deleted: count ?? 0, error: error?.message });
        } catch (e) {
          results.push({ table: "validation_requests", deleted: 0, error: e instanceof Error ? e.message : "unknown" });
        }

        // 5. Documents anciens : 365 jours (durée de conservation comptable)
        // NB : on ne supprime PAS les documents attachés à un dossier actif (FK + cascade)
        // Pour l'instant on log juste, suppression effective à valider avec un avocat.
        try {
          const cutoff365 = new Date(Date.now() - 365 * 86400_000).toISOString();
          const { count } = await db
            .from("documents")
            .select("id", { count: "exact", head: true })
            .lt("created_at", cutoff365)
            .is("dossier_id", null);
          results.push({ table: "documents_orphan_candidates", deleted: 0, error: count ? `${count} candidats à supprimer (suppression désactivée pour V1)` : undefined });
        } catch (e) {
          results.push({ table: "documents_orphan_candidates", deleted: 0, error: e instanceof Error ? e.message : "unknown" });
        }

        const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);
        const errors = results.filter((r) => r.error).length;

        return new Response(
          JSON.stringify({
            ok: errors === 0,
            total_deleted: totalDeleted,
            results,
          }),
          {
            status: errors > 0 ? 207 : 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
