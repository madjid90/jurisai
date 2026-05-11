// Cron hook : orchestrator-tick — watchdog des batches d'ingestion juridique.
// Détecte les batches en `paused` ou en `running` mais inactifs depuis plus de
// 5 min (= worker mort sans relancer le tick suivant) et redéclenche la edge
// function correspondante avec resume_batch_id + le secret interne.
//
// Appelé toutes les 5 min par pg_cron. Sécurité : header x-cron-secret.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronAuth } from "@/server/_shared/cron-auth.server";

// Map connector → edge function name
const CONNECTOR_FN: Record<string, string> = {
  "kali-full": "connector-kali-full",
  "legifrance-full": "connector-legifrance-full",
  "judilibre-full": "connector-judilibre-full",
  "jade-full": "connector-jade-full",
  "bofip-full": "connector-bofip-full",
  "cdtn-fiches": "connector-cdtn-fiches",
  "cdtn-modeles-full": "connector-cdtn-modeles-full",
  "cdtn-contributions-full": "connector-cdtn-contributions-full",
  "cnil-full": "connector-cnil-full",
  "dole-full": "connector-dole-full",
  "acco-full": "connector-acco-full",
};

const STALE_MINUTES = 5;

export const Route = createFileRoute("/api/public/hooks/orchestrator-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) {
          return Response.json({ ok: false, error: "CRON_SECRET missing" }, { status: 503 });
        }

        // 1. Cleanup zombies (running > 30 min sans tick → repassés en paused)
        try {
          await supabaseAdmin.rpc("cleanup_zombie_batches");
        } catch (err) {
          console.warn("[orchestrator-tick] cleanup_zombie_batches:", (err as Error).message);
        }

        // 2. Trouver les batches à relancer : paused OU running stale (>5 min)
        const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
        const { data: pendingRaw, error } = await supabaseAdmin
          .from("ingestion_batch_state")
          .select("id, connector, status, last_tick_at, total_count, processed_count")
          .in("status", ["paused", "running"])
          .lt("last_tick_at", staleThreshold)
          .order("last_tick_at", { ascending: true })
          .limit(20);

        if (error) {
          console.error("[orchestrator-tick] list batches:", error.message);
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        type PendingBatch = {
          id: string;
          connector: string;
          status: string;
          last_tick_at: string | null;
          total_count: number | null;
          processed_count: number | null;
        };
        const pending = (pendingRaw ?? []) as unknown as PendingBatch[];

        const launched: Array<{
          batch_id: string;
          connector: string;
          ok: boolean;
          stale_seconds: number;
          progress: string;
          error?: string;
        }> = [];

        for (const b of pending) {
          const fnName = CONNECTOR_FN[b.connector];
          const staleSec = b.last_tick_at
            ? Math.round((Date.now() - new Date(b.last_tick_at).getTime()) / 1000)
            : -1;
          const progress = `${b.processed_count ?? 0}/${b.total_count ?? 0}`;

          if (!fnName) {
            launched.push({
              batch_id: b.id, connector: b.connector, ok: false,
              stale_seconds: staleSec, progress, error: "no edge function mapped",
            });
            continue;
          }

          try {
            // Fire-and-forget : on n'attend pas la fin de l'ingestion (le worker
            // tourne 60s en background via EdgeRuntime.waitUntil). On envoie le
            // x-internal-cron pour bypasser requireSuperAdmin côté edge.
            const ctrl = new AbortController();
            const timeout = setTimeout(() => ctrl.abort(), 5_000);
            try {
              await supabaseAdmin.functions.invoke(fnName, {
                body: { resume_batch_id: b.id },
                headers: { "x-internal-cron": cronSecret },
              });
            } catch (err) {
              const msg = String(err);
              // Abort réseau attendu — la fonction continue côté serveur
              if (!msg.includes("aborted") && !msg.includes("AbortError")) throw err;
            } finally {
              clearTimeout(timeout);
            }
            launched.push({
              batch_id: b.id, connector: b.connector, ok: true,
              stale_seconds: staleSec, progress,
            });
          } catch (err) {
            launched.push({
              batch_id: b.id, connector: b.connector, ok: false,
              stale_seconds: staleSec, progress, error: (err as Error).message,
            });
          }
        }

        return Response.json({
          ok: true,
          inspected: pending.length,
          resumed: launched.filter((l) => l.ok).length,
          stale_threshold_minutes: STALE_MINUTES,
          launched,
          timestamp: new Date().toISOString(),
        });
      },
    },
  },
});
