// LOT 11 — Worker email outbox.
//
// Cron pg_cron toutes les 1 min → POST /api/public/hooks/email-worker.
// Dépile jusqu'à 50 emails pending et tente l'envoi (avec backoff).
// Sécurité : CRON_SECRET obligatoire.

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronAuth } from "@/server/_shared/cron-auth.server";
import { processEmailBatch } from "@/server/_shared/email-outbox.server";

export const Route = createFileRoute("/api/public/hooks/email-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        try {
          const summary = await processEmailBatch(50);
          return new Response(
            JSON.stringify({ success: true, ...summary }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          console.error("[email-worker] batch failed", e);
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
