// Cron mensuel : orchestrateur de mise à jour des barèmes officiels.
//
// Appelle séquentiellement tous les connecteurs (CDTN, INSEE, Legifrance, BOSS, BOFIP)
// et chacun soumet ses propositions via proposeReferenceValueUpdate.
// Les propositions atterrissent dans /admin/baremes pour validation humaine.
//
// Fréquence : 1er du mois à 04:00 UTC (pg_cron).
// Auth : x-cron-secret uniquement.

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronAuth } from "@/server/_shared/cron-auth.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyUser } from "@/server/_shared/notify.server";
import { fetchCdtnBaremes } from "@/server/_shared/connectors/cdtn-baremes.server";
import { fetchInseeIndices } from "@/server/_shared/connectors/insee-bdm.server";
import { fetchLegifranceBaremes } from "@/server/_shared/connectors/legifrance-baremes.server";
import { fetchBofipFiscalRates } from "@/server/_shared/connectors/bofip-fiscal.server";
import { fetchBossUrssafRates } from "@/server/_shared/connectors/boss-urssaf.server";

type ConnectorReport = {
  connector: string;
  ok: boolean;
  proposed: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
};

async function runConnector(
  name: string,
  fn: () => Promise<{ proposed: number; skipped: number; errors: string[] }>,
): Promise<ConnectorReport> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { connector: name, ok: true, proposed: r.proposed, skipped: r.skipped, errors: r.errors, duration_ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "connector failed";
    return { connector: name, ok: false, proposed: 0, skipped: 0, errors: [msg], duration_ms: Date.now() - t0 };
  }
}

export const Route = createFileRoute("/api/public/hooks/baremes-orchestrator")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        // Lance les connecteurs en parallèle (ils n'ont pas de dépendances entre eux)
        const reports = await Promise.all([
          runConnector("cdtn", fetchCdtnBaremes),
          runConnector("insee", fetchInseeIndices),
          runConnector("legifrance", fetchLegifranceBaremes),
          runConnector("bofip", fetchBofipFiscalRates),
          runConnector("boss", fetchBossUrssafRates),
        ]);

        const totalProposed = reports.reduce((s, r) => s + r.proposed, 0);
        const totalSkipped = reports.reduce((s, r) => s + r.skipped, 0);
        const anyError = reports.some((r) => !r.ok || r.errors.length > 0);

        // Notifie les super_admins s'il y a des propositions à valider
        if (totalProposed > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sb = supabaseAdmin as any;
          try {
            const { data: admins } = await sb
              .from("user_roles")
              .select("user_id, tenant_id")
              .eq("role", "super_admin");
            for (const a of (admins ?? []) as Array<{ user_id: string; tenant_id: string | null }>) {
              if (!a.tenant_id) continue;
              await notifyUser({
                userId: a.user_id,
                tenantId: a.tenant_id,
                kind: "bareme_proposal",
                title: `${totalProposed} nouvelle(s) proposition(s) de barème à valider`,
                body: `Les connecteurs ont détecté ${totalProposed} valeur(s) officielle(s) à mettre à jour.`,
                link: "/admin/baremes",
                metadata: { total_proposed: totalProposed, reports },
              }).catch(() => {});
            }
          } catch (e) {
            console.error("[baremes-orchestrator] notif super_admins failed:", e);
          }
        }

        return new Response(
          JSON.stringify({
            ok: !anyError,
            total_proposed: totalProposed,
            total_skipped: totalSkipped,
            reports,
          }),
          {
            status: anyError ? 207 : 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
