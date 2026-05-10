// Cron hook : scanne les échéances de contrats à venir et notifie les membres du tenant.
// Appelé quotidiennement par pg_cron. Notifie pour les échéances dans 30/14/7/2 jours.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyUser } from "@/server/_shared/notify.server";
import { verifyCronAuth } from "@/server/_shared/cron-auth.server";

const REMIND_AT_DAYS = [30, 14, 7, 2];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

export const Route = createFileRoute("/api/public/hooks/contract-deadlines")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;
        const now = new Date();
        const horizon = new Date(now.getTime() + 31 * 86400_000);

        const { data: rows, error } = await db
          .from("contract_deadlines")
          .select("id, tenant_id, dossier_id, label, due_date, category, reminded_at")
          .is("done_at", null)
          .gte("due_date", now.toISOString().slice(0, 10))
          .lte("due_date", horizon.toISOString().slice(0, 10));

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }

        let notified = 0;

        for (const r of (rows ?? []) as Array<{
          id: string;
          tenant_id: string;
          dossier_id: string | null;
          label: string;
          due_date: string;
          category: string | null;
          reminded_at: string | null;
        }>) {
          const due = new Date(r.due_date + "T00:00:00Z");
          const days = Math.ceil((due.getTime() - now.getTime()) / 86400_000);
          if (!REMIND_AT_DAYS.includes(days)) continue;

          // Évite double notif le même jour
          if (r.reminded_at) {
            const last = new Date(r.reminded_at);
            if (now.getTime() - last.getTime() < 20 * 3600_000) continue;
          }

          const { data: members } = await db
            .from("profiles")
            .select("id")
            .eq("tenant_id", r.tenant_id);

          for (const m of (members ?? []) as Array<{ id: string }>) {
            await notifyUser({
              userId: m.id,
              tenantId: r.tenant_id,
              kind: "contract_deadline",
              title: `Échéance dans ${days} jour${days > 1 ? "s" : ""}`,
              body: `${r.label} — ${r.due_date}`,
              link: r.dossier_id ? `/dossiers/${r.dossier_id}` : "/agent",
              metadata: { deadline_id: r.id, days, category: r.category },
            });
          }

          await db
            .from("contract_deadlines")
            .update({ reminded_at: new Date().toISOString() })
            .eq("id", r.id);
          notified++;
        }

        return new Response(JSON.stringify({ ok: true, scanned: rows?.length ?? 0, notified }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
