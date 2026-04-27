// Admin server functions for managing data connectors.
// All require super_admin role.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertSuperAdmin(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Accès réservé aux super-administrateurs");
}

export const listConnectorJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("ingestion_jobs")
      .select("id, connector, status, source_type, items_total, items_processed, items_failed, started_at, finished_at, params, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { jobs: data ?? [] };
  });

export const listConnectorErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { jobId?: string; connector?: string }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    // Cast to any: types not yet regenerated for ingestion_errors after migration
    const client = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => Promise<{ data: ConnectorErrorRow[] | null; error: { message: string } | null }>;
            eq: (col: string, val: string) => unknown;
          };
        };
      };
    };
    let q = client
      .from("ingestion_errors")
      .select("id, connector, external_id, error_type, error_message, created_at, resolved")
      .order("created_at", { ascending: false }) as unknown as {
        limit: (n: number) => Promise<{ data: ConnectorErrorRow[] | null; error: { message: string } | null }>;
        eq: (col: string, val: string) => unknown;
      };
    if (data.jobId) q = q.eq("job_id", data.jobId) as typeof q;
    if (data.connector) q = q.eq("connector", data.connector) as typeof q;
    const { data: rows, error } = await q.limit(100);
    if (error) throw new Error(error.message);
    return { errors: (rows ?? []) as ConnectorErrorRow[] };
  });

export type ConnectorErrorRow = {
  id: string;
  connector: string;
  external_id: string | null;
  error_type: string;
  error_message: string;
  created_at: string;
  resolved: boolean;
};

export const getConnectorStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const [sources, chunks, conventions, templates] = await Promise.all([
      supabaseAdmin.from("legal_sources").select("connector", { count: "exact", head: false }),
      supabaseAdmin.from("legal_chunks").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("conventions_collectives").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("templates_public").select("id", { count: "exact", head: true }),
    ]);

    // Group sources per connector
    const byConnector: Record<string, number> = {};
    (sources.data ?? []).forEach((r) => {
      const k = (r as { connector: string | null }).connector ?? "manual";
      byConnector[k] = (byConnector[k] ?? 0) + 1;
    });

    return {
      total_sources: sources.count ?? (sources.data?.length ?? 0),
      total_chunks: chunks.count ?? 0,
      total_conventions: conventions.count ?? 0,
      total_templates: templates.count ?? 0,
      sources_by_connector: byConnector,
    };
  });

export const triggerConnector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    connector: "kali" | "cdtn-modeles" | "legifrance" | "judilibre";
    payload?: Record<string, unknown>;
  }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const fnName = `connector-${data.connector}`;
    const { data: result, error } = await supabaseAdmin.functions.invoke(fnName, {
      body: data.payload ?? {},
    });
    if (error) throw new Error(`${fnName}: ${error.message}`);
    return { result };
  });

export const checkConnectorSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    // We can't read secrets values from the server; we just describe what's expected.
    // The actual presence is checked at edge-function call time.
    return {
      required: [
        { name: "LEGIFRANCE_OAUTH_ID", connector: "legifrance", description: "client_id PISTE" },
        { name: "LEGIFRANCE_OAUTH_SECRET", connector: "legifrance", description: "client_secret PISTE" },
        { name: "JUDILIBRE_KEY_ID", connector: "judilibre", description: "KeyId PISTE" },
      ],
    };
  });
