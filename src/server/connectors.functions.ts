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

export type ConnectorJobRow = {
  id: string;
  connector: string | null;
  status: string;
  job_type: string | null;
  items_total: number | null;
  items_processed: number | null;
  items_failed: number | null;
  completed_at: string | null;
  last_tick_at: string | null;
  params: Record<string, unknown> | null | object;
  created_at: string;
};

export const listConnectorJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    // Read batches from ingestion_batch_state (used by *-full connectors)
    // and map to the ConnectorJobRow shape expected by the UI.
    const client = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => Promise<{
              data: Array<{
                id: string;
                connector: string | null;
                batch_type: string | null;
                status: string;
                total_count: number | null;
                processed_count: number | null;
                failed_count: number | null;
                articles_ingested: number | null;
                articles_skipped_unchanged: number | null;
                completed_at: string | null;
                metadata: Record<string, unknown> | null;
                started_at: string;
                last_tick_at: string | null;
              }> | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
    const { data, error } = await client
      .from("ingestion_batch_state")
      .select("id, connector, batch_type, status, total_count, processed_count, failed_count, articles_ingested, articles_skipped_unchanged, completed_at, metadata, started_at, last_tick_at")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const jobs: ConnectorJobRow[] = (data ?? []).map((b) => ({
      id: b.id,
      connector: b.connector,
      status: b.status,
      job_type: b.batch_type,
      items_total: b.total_count,
      items_processed: b.processed_count,
      items_failed: b.failed_count,
      completed_at: b.completed_at,
      last_tick_at: b.last_tick_at,
      params: {
        ...(b.metadata ?? {}),
        articles_ingested: b.articles_ingested ?? 0,
        articles_skipped: b.articles_skipped_unchanged ?? 0,
        last_tick_at: b.last_tick_at,
      },
      created_at: b.started_at,
    }));
    return { jobs };
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
    connector: "kali-full" | "legifrance-full" | "judilibre-full" | "jade-full" | "bofip-full" | "cdtn-fiches" | "cdtn-modeles-full" | "cdtn-contributions-full" | "cnil-full" | "dole-full" | "acco-full";
    payload?: Record<string, unknown>;
  }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const fnName = `connector-${data.connector}`;
    let payload = data.payload ?? {};

    if ((data.connector === "bofip-full" || data.connector === "judilibre-full") && !payload.resume_batch_id) {
      const { data: activeBatch, error: activeBatchError } = await supabaseAdmin
        .from("ingestion_batch_state")
        .select("id")
        .eq("connector", data.connector)
        .in("status", ["running", "paused", "pending"])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeBatchError) {
        throw new Error(`Batch lookup failed: ${activeBatchError.message}`);
      }

      if (activeBatch?.id) {
        payload = { ...payload, resume_batch_id: activeBatch.id };
      }
    }

    // Forward the caller's JWT so the edge function's requireSuperAdmin
    // can verify the user (service role key would fail auth.getUser).
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const authHeader = getRequestHeader("authorization");

    try {
      const { data: result, error } = await supabaseAdmin.functions.invoke(fnName, {
        body: payload,
        headers: authHeader ? { Authorization: authHeader } : undefined,
      });
      if (error) {
        let detail = error.message ?? "unknown error";
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === "function") {
          try {
            const body = await ctx.text();
            if (body) detail = body.slice(0, 500);
          } catch { /* ignore */ }
        }
        console.error(`[${fnName}] edge invoke failed:`, detail);
        return {
          ok: false,
          fallback: true,
          connector: data.connector,
          error: `${fnName}: ${detail}`,
        };
      }
      return { ok: true, fallback: false, connector: data.connector, result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${fnName}] unexpected error:`, msg);
      return {
        ok: false,
        fallback: true,
        connector: data.connector,
        error: `${fnName}: ${msg}`,
      };
    }
  });

export const deleteConnectorJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { jobId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const client = supabaseAdmin as unknown as {
      from: (t: string) => {
        delete: () => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> };
      };
    };
    const { error } = await client.from("ingestion_batch_state").delete().eq("id", data.jobId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteFailedConnectorJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { connector?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const client = supabaseAdmin as unknown as {
      from: (t: string) => {
        delete: () => {
          eq: (col: string, val: string) => Promise<{ error: { message: string } | null; count?: number | null }> & {
            eq: (col: string, val: string) => Promise<{ error: { message: string } | null; count?: number | null }>;
          };
        };
      };
    };
    let q = client.from("ingestion_batch_state").delete().eq("status", "failed");
    if (data.connector) q = (q as unknown as { eq: (c: string, v: string) => typeof q }).eq("connector", data.connector);
    const { error } = await (q as unknown as Promise<{ error: { message: string } | null }>);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const retryEmptySources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { connector: "bofip" | "judilibre" | "cdtn-fiches" | "legifrance"; max_items?: number; dry_run?: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const authHeader = getRequestHeader("authorization");
    try {
      const { data: result, error } = await supabaseAdmin.functions.invoke("connector-retry-empty", {
        body: { connector: data.connector, max_items: data.max_items, dry_run: data.dry_run === true },
        headers: authHeader ? { Authorization: authHeader } : undefined,
      });
      if (error) {
        let detail = error.message ?? "unknown error";
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === "function") {
          try { const body = await ctx.text(); if (body) detail = body.slice(0, 500); } catch { /* ignore */ }
        }
        return { ok: false, connector: data.connector, error: detail };
      }
      return { ok: true, connector: data.connector, result };
    } catch (e) {
      return { ok: false, connector: data.connector, error: e instanceof Error ? e.message : String(e) };
    }
  });

export const countEmptySources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const { data, error } = await supabaseAdmin.rpc("count_empty_sources_by_connector");
    if (error) throw new Error(error.message);
    const byConnector: Record<string, number> = {};
    let total = 0;
    for (const row of (data ?? []) as Array<{ connector: string; count: number }>) {
      const n = Number(row.count) || 0;
      byConnector[row.connector] = n;
      total += n;
    }
    return { by_connector: byConnector, total };
  });

export const checkConnectorSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const required = [
      { name: "LEGIFRANCE_OAUTH_ID", connector: "legifrance", description: "client_id PISTE" },
      { name: "LEGIFRANCE_OAUTH_SECRET", connector: "legifrance", description: "client_secret PISTE", sensitive: true },
      { name: "PISTE_API_KEY", connector: "judilibre", description: "clé API PISTE (UUID)", sensitive: true },
    ] as const;
    return {
      required: required.map((s) => {
        const value = process.env[s.name] ?? "";
        return {
          name: s.name,
          connector: s.connector,
          description: s.description,
          sensitive: "sensitive" in s ? s.sensitive : false,
          present: value.length > 0,
          value, // exposé uniquement aux super-admins (middleware ci-dessus)
        };
      }),
    };
  });
