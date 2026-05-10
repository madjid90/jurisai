// Cron hook : orchestrator-tick — relance automatiquement les batches d'ingestion
// juridique mis en pause (status='paused') ou idle (status='running' inactif).
//
// Appelé toutes les 10 min par pg_cron (ou un cron externe).
// Sécurité : valide l'apikey (= anon key Supabase). Aucune donnée sensible
// n'est exposée — la route déclenche seulement les fonctions d'ingestion.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Map connector → edge function name
const CONNECTOR_FN: Record<string, string> = {
  "kali-full": "connector-kali-full",
  // Other full connectors will be wired here as they ship.
};

export const Route = createFileRoute("/api/public/hooks/orchestrator-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("authorization")?.replace("Bearer ", "");
        if (!apikey || apikey !== ANON_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        // 1. Cleanup zombies older than 1h
        try {
          await supabaseAdmin.rpc("cleanup_zombie_batches");
        } catch (err) {
          console.warn("[orchestrator-tick] cleanup_zombie_batches failed:", (err as Error).message);
        }

        // 2. Find paused or stale-running batches to resume
        const { data: pendingRaw, error } = await supabaseAdmin
          .from("ingestion_batch_state")
          .select("id, connector, status, updated_at, items_total, items_processed")
          .in("status", ["paused", "running"])
          .order("updated_at", { ascending: true })
          .limit(20);

        if (error) {
          console.error("[orchestrator-tick] list batches error:", error.message);
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        type PendingBatch = {
          id: string;
          connector: string;
          status: string;
          updated_at: string;
          items_total: number | null;
          items_processed: number | null;
        };
        const pending = (pendingRaw ?? []) as unknown as PendingBatch[];

        const STALE_MS = 5 * 60 * 1000;
        const now = Date.now();
        const toResume = pending.filter((b) => {
          if (b.status === "paused") return true;
          // running but stale (no progress for >5min) → consider abandoned, retry
          return now - new Date(b.updated_at).getTime() > STALE_MS;
        });

        const launched: Array<{ batch_id: string; connector: string; ok: boolean; error?: string }> = [];

        for (const b of toResume) {
          const fnName = CONNECTOR_FN[b.connector];
          if (!fnName) {
            launched.push({ batch_id: b.id, connector: b.connector, ok: false, error: "no edge function mapped" });
            continue;
          }
          try {
            // Fire-and-forget — we don't await full ingestion (135s budget per call).
            // We use invoke without await would still buffer in Node; instead set a short timeout.
            const ctrl = new AbortController();
            const timeout = setTimeout(() => ctrl.abort(), 5_000);
            await supabaseAdmin.functions.invoke(fnName, {
              body: { resume_batch_id: b.id },
            }).catch((err) => {
              // Network abort is fine — function continues server-side.
              if (!String(err).includes("aborted")) throw err;
            });
            clearTimeout(timeout);
            launched.push({ batch_id: b.id, connector: b.connector, ok: true });
          } catch (err) {
            launched.push({ batch_id: b.id, connector: b.connector, ok: false, error: (err as Error).message });
          }
        }

        return Response.json({
          ok: true,
          inspected: pending?.length ?? 0,
          resumed: launched.filter((l) => l.ok).length,
          launched,
          timestamp: new Date().toISOString(),
        });
      },
    },
  },
});
