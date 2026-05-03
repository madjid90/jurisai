// Server functions de base pour la "boîte aux lettres" de l'agent (agent_runs).
// Étape 1 du plan async : créer une demande, la lire, lister les demandes courantes.
// Le moteur d'exécution (worker) viendra dans une étape suivante.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "./_shared/tenant.server";

const STATUSES = [
  "pending",
  "running",
  "waiting_info",
  "waiting_validation",
  "ready",
  "executed",
  "archived",
  "failed",
] as const;
export type AgentRunStatus = (typeof STATUSES)[number];

const CreateInput = z.object({
  message: z.string().min(1).max(8000),
  dossier_id: z.string().uuid().nullable().optional(),
  title: z.string().max(200).optional(),
  attachments: z
    .array(z.object({ analysis_id: z.string().uuid().optional(), filename: z.string().optional() }))
    .optional(),
});

/**
 * Crée une nouvelle demande à l'agent. Réponse immédiate (status=pending).
 * Le worker prendra le relais en asynchrone (étape suivante).
 */
export const createAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const draft = {
      attachments: data.attachments ?? [],
      questions: [] as unknown[],
      form: null as unknown,
      validation: null as unknown,
      analysis: null as unknown,
      procedure: null as unknown,
      sources: [] as unknown[],
    };

    const { data: row, error } = await supabaseAdmin
      .from("agent_runs")
      .insert({
        user_id: userId,
        tenant_id: tenantId,
        dossier_id: data.dossier_id ?? null,
        message: data.message,
        title: data.title ?? data.message.slice(0, 80),
        status: "pending",
        draft,
      } as never)
      .select("id, status, created_at")
      .single();

    if (error) throw new Error(error.message);
    return row;
  });

/** Récupère une demande (RLS limite au tenant). */
export const getAgentRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    const { data: row, error } = await supabaseAdmin
      .from("agent_runs")
      .select("*")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("Demande introuvable");
    return row;
  });

const ListInput = z.object({
  status: z.enum(STATUSES).optional(),
  scope: z.enum(["mine", "tenant"]).default("mine"),
  limit: z.number().int().min(1).max(100).default(50),
});

/** Liste les demandes (par défaut : les miennes, toutes statuts). */
export const listMyRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const tenantId = await getTenantId(userId);

    let q = supabaseAdmin
      .from("agent_runs")
      .select(
        "id, title, message, status, intent, domain, dossier_id, created_at, updated_at, executed_at, archived_at"
      )
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(data.limit);

    if (data.scope === "mine") q = q.eq("user_id", userId);
    if (data.status) q = q.eq("status", data.status);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
