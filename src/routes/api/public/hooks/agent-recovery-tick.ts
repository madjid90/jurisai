// Cron hook : watchdog des agent_runs orphelins (C4).
// Scanne TOUS les tenants, repère les runs bloquées dans un état non-terminal
// au-delà du seuil, et les marque comme `failed` avec un message d'erreur clair.
// Notifie également l'utilisateur via in-app notification.
//
// Authentification : x-cron-secret seulement (pas de JWT user — appelable depuis pg_cron).
//
// Politique :
//   - pending / waiting_info > 30 minutes  → failed("Demande expirée — réessayez")
//   - running / executing    > 10 minutes  → failed("Traitement interrompu — réessayez")
//   - waiting_validation     > 7 jours     → archived (auto-archive)

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyUser } from "@/server/_shared/notify.server";
import { verifyCronAuth } from "@/server/_shared/cron-auth.server";

const STUCK_USER_INPUT_MIN = 30;     // pending + waiting_info
const STUCK_PROCESSING_MIN = 10;     // running + executing
const STALE_VALIDATION_DAYS = 7;     // waiting_validation

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

type StuckRun = {
  id: string;
  tenant_id: string;
  user_id: string;
  status: string;
  message: string | null;
  created_at: string;
  updated_at: string | null;
};

export const Route = createFileRoute("/api/public/hooks/agent-recovery-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        const now = Date.now();
        const userInputCutoff = new Date(now - STUCK_USER_INPUT_MIN * 60_000).toISOString();
        const processingCutoff = new Date(now - STUCK_PROCESSING_MIN * 60_000).toISOString();
        const validationCutoff = new Date(now - STALE_VALIDATION_DAYS * 86_400_000).toISOString();

        const results = { failed_user: 0, failed_proc: 0, archived: 0, errors: [] as string[] };

        // 1. pending + waiting_info bloqués
        const { data: stuckInput, error: e1 } = await db
          .from("agent_runs")
          .select("id, tenant_id, user_id, status, message, created_at, updated_at")
          .in("status", ["pending", "waiting_info"])
          .lt("updated_at", userInputCutoff)
          .limit(200);
        if (e1) results.errors.push(`stuck_input: ${e1.message}`);

        for (const r of (stuckInput ?? []) as StuckRun[]) {
          const errMsg = "Demande expirée (aucune action depuis 30 min). Veuillez relancer.";
          const { error: upErr } = await db
            .from("agent_runs")
            .update({
              status: "failed",
              error_message: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", r.id)
            .in("status", ["pending", "waiting_info"]);
          if (upErr) {
            results.errors.push(`update ${r.id}: ${upErr.message}`);
            continue;
          }
          await notifyUser({
            userId: r.user_id,
            tenantId: r.tenant_id,
            kind: "agent_run_failed",
            title: "Une demande n'a pas pu aboutir",
            body: (r.message ?? "").slice(0, 80) || "Demande expirée — relancez-la.",
            link: "/chat",
            metadata: { run_id: r.id, reason: "stuck_user_input" },
          }).catch(() => {});
          results.failed_user++;
        }

        // 2. running / executing bloqués (traitement crash)
        const { data: stuckProc, error: e2 } = await db
          .from("agent_runs")
          .select("id, tenant_id, user_id, status, message, created_at, updated_at")
          .in("status", ["running", "executing"])
          .lt("updated_at", processingCutoff)
          .limit(200);
        if (e2) results.errors.push(`stuck_proc: ${e2.message}`);

        for (const r of (stuckProc ?? []) as StuckRun[]) {
          const errMsg = "Traitement interrompu (timeout interne). Veuillez relancer la demande.";
          const { error: upErr } = await db
            .from("agent_runs")
            .update({
              status: "failed",
              error_message: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", r.id)
            .in("status", ["running", "executing"]);
          if (upErr) {
            results.errors.push(`update ${r.id}: ${upErr.message}`);
            continue;
          }
          await notifyUser({
            userId: r.user_id,
            tenantId: r.tenant_id,
            kind: "agent_run_failed",
            title: "Une demande n'a pas pu aboutir",
            body: (r.message ?? "").slice(0, 80) || "Traitement interrompu — relancez-la.",
            link: "/chat",
            metadata: { run_id: r.id, reason: "stuck_processing" },
          }).catch(() => {});
          results.failed_proc++;
        }

        // 3. waiting_validation > 7 jours → archive auto
        const { data: staleVal, error: e3 } = await db
          .from("agent_runs")
          .select("id, tenant_id, user_id, status, message, created_at, updated_at")
          .eq("status", "waiting_validation")
          .lt("updated_at", validationCutoff)
          .limit(200);
        if (e3) results.errors.push(`stale_val: ${e3.message}`);

        for (const r of (staleVal ?? []) as StuckRun[]) {
          const { error: upErr } = await db
            .from("agent_runs")
            .update({ status: "archived", updated_at: new Date().toISOString() })
            .eq("id", r.id)
            .eq("status", "waiting_validation");
          if (upErr) {
            results.errors.push(`archive ${r.id}: ${upErr.message}`);
            continue;
          }
          results.archived++;
        }

        return new Response(JSON.stringify({ ok: true, ...results }), {
          status: results.errors.length > 0 ? 207 : 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
