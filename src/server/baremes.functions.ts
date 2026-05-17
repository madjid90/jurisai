// Server functions pour l'admin des barèmes : santé, propositions, validation.
// Toutes protégées par super_admin.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  listPendingProposals,
  validateProposal,
  rejectProposal,
} from "@/server/_shared/bareme-proposals.server";
import { checkBaremesHealth, getRecentBaremeUpdates } from "@/server/_shared/bareme-updater.server";

async function requireSuperAdmin(userId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: super_admin role required");
}

export const getBaremesHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    await requireSuperAdmin(userId);
    return checkBaremesHealth();
  });

export const getPendingProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    await requireSuperAdmin(userId);
    return listPendingProposals();
  });

export const getRecentUpdates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    await requireSuperAdmin(userId);
    return getRecentBaremeUpdates(50);
  });

export const validateBaremeProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ proposalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await requireSuperAdmin(userId);
    return validateProposal(data.proposalId, userId);
  });

export const rejectBaremeProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ proposalId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await requireSuperAdmin(userId);
    await rejectProposal(data.proposalId, userId, data.reason);
    return { ok: true };
  });

/**
 * Déclenche manuellement l'orchestrateur (en plus du cron mensuel).
 * Utile pour tester ou forcer une recherche immédiate.
 */
export const triggerBaremesOrchestrator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    await requireSuperAdmin(userId);

    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) throw new Error("CRON_SECRET non configuré");

    const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app";
    const res = await fetch(`${baseUrl}/api/public/hooks/baremes-orchestrator`, {
      method: "POST",
      headers: { "x-cron-secret": cronSecret, "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Orchestrator: HTTP ${res.status} — ${body}`);
    return JSON.parse(body);
  });
