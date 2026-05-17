// Cron hook : déclenche l'edge function legal-watch-cron qui scanne les
// nouvelles legal_sources, crée des legal_alerts et fanout vers notifications.
//
// Appelé quotidiennement par pg_cron via x-cron-secret.

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronAuth } from "@/server/_shared/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/legal-watch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SERVICE_ROLE =
          process.env.JURISAI_SUPABASE_SERVICE_ROLE_KEY ||
          process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!SUPABASE_URL || !SERVICE_ROLE) {
          return new Response(
            JSON.stringify({ error: "SUPABASE_URL or SERVICE_ROLE_KEY missing" }),
            { status: 500 },
          );
        }

        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-watch-cron`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SERVICE_ROLE}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          });
          const body = await res.text();
          return new Response(body, {
            status: res.status,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "edge call failed";
          return new Response(JSON.stringify({ error: msg }), { status: 502 });
        }
      },
    },
  },
});
