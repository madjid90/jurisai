// Cron hook : dispatche les rappels (reminders) arrivés à échéance en
// notifications utilisateur. Idempotent via `sent_at`.
//
// Appelé par pg_cron toutes les 10 minutes (voir cron.schedule).
// Sécurité : route /api/public/* — on exige tout de même l'apikey.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { verifyCronAuth } from "@/server/_shared/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/dispatch-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !serviceKey) {
          return new Response(
            JSON.stringify({ error: "server misconfigured" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const supabase = createClient(url, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const nowIso = new Date().toISOString();
        const { data: due, error } = await supabase
          .from("reminders")
          .select("id, tenant_id, user_id, dossier_id, title, body, metadata")
          .lte("remind_at", nowIso)
          .is("sent_at", null)
          .is("dismissed_at", null)
          .limit(200);

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        let dispatched = 0;
        for (const r of due ?? []) {
          const { error: notifErr } = await supabase
            .from("notifications")
            .insert({
              user_id: r.user_id,
              tenant_id: r.tenant_id,
              kind: "reminder_due",
              title: r.title,
              body: r.body,
              link: r.dossier_id ? `/dossiers/${r.dossier_id}` : "/notifications",
              metadata: { ...(r.metadata ?? {}), reminder_id: r.id },
            });
          if (notifErr) {
            console.error("[dispatch-reminders] notification insert failed", notifErr.message);
            continue;
          }
          await supabase
            .from("reminders")
            .update({ sent_at: new Date().toISOString() })
            .eq("id", r.id);
          dispatched += 1;
        }

        return new Response(
          JSON.stringify({ success: true, found: due?.length ?? 0, dispatched }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
