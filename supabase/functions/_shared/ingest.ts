// Shared ingestion helpers used by all connector edge functions.
// Handles: source upsert, chunking + embeddings batch, jobs tracking, error logging.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { embedTexts } from "./embeddings.ts";
import { smartChunk } from "./smart-chunk.ts";

export type ConnectorName =
  | "legifrance"
  | "judilibre"
  | "kali"
  | "bofip"
  | "cdtn-modeles"
  | "service-public"
  | "cnil"
  | "manual";

export interface SourceInput {
  external_id: string;
  source_type: string; // 'code_article' | 'jurisprudence' | 'convention' | ...
  title: string;
  content: string;
  reference_code?: string | null;
  official_url?: string | null;
  legal_date?: string | null; // YYYY-MM-DD
  idcc?: string | null;
  raw_metadata?: Record<string, unknown>;
}

export function getAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getLovableApiKey(): string {
  const k = Deno.env.get("LOVABLE_API_KEY");
  if (!k) throw new Error("LOVABLE_API_KEY missing in edge function secrets");
  return k;
}

/** Create a job row in 'running' state and return its id. */
export async function startJob(
  db: SupabaseClient,
  connector: ConnectorName,
  params: Record<string, unknown> = {},
  triggeredBy?: string,
): Promise<string> {
  const { data, error } = await db
    .from("ingestion_jobs")
    .insert({
      connector,
      job_type: connector,
      status: "running",
      params,
      triggered_by: triggeredBy ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateJob(
  db: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db.from("ingestion_jobs").update(patch).eq("id", jobId);
}

export async function finishJob(
  db: SupabaseClient,
  jobId: string,
  status: "completed" | "failed",
  extra: Record<string, unknown> = {},
): Promise<void> {
  await db.from("ingestion_jobs").update({
    status,
    completed_at: new Date().toISOString(),
    ...extra,
  }).eq("id", jobId);
}

export async function logError(
  db: SupabaseClient,
  jobId: string,
  connector: ConnectorName,
  externalId: string | null,
  errorType: string,
  errorMessage: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.from("ingestion_errors").insert({
    job_id: jobId,
    connector,
    external_id: externalId,
    error_type: errorType,
    error_message: errorMessage.slice(0, 2000),
    payload,
  });
}

/**
 * Upsert one legal source + (re)generate its chunks + embeddings.
 *
 * Uses STAGING + PROMOTE pattern:
 *  1. Upsert legal_source row
 *  2. Insert chunks + embeddings into legal_chunks_staging (linked to job_id)
 *  3. Call promote_ingestion_job(job_id) which atomically swaps staging → live
 *
 * This guarantees the live legal_chunks table is never in a partial state
 * (vs old "delete-then-insert" which could leave a source with 0 chunks if embedding failed).
 *
 * Idempotent on (connector, external_id).
 */
export async function ingestSource(
  db: SupabaseClient,
  apiKey: string,
  connector: ConnectorName,
  src: SourceInput,
  jobId?: string,
): Promise<{ source_id: string; chunks: number; promoted: boolean }> {
  // 1. Upsert source.
  // Avoid PostgREST ON CONFLICT inference here because the current project uses
  // a partial unique index on (connector, external_id), which can fail to match
  // during upsert for some connectors in production.
  const sourcePayload = {
    connector,
    external_id: src.external_id,
    source_type: src.source_type,
    title: src.title,
    reference_code: src.reference_code ?? null,
    official_url: src.official_url ?? null,
    legal_date: src.legal_date ?? null,
    idcc: src.idcc ?? null,
    raw_metadata: src.raw_metadata ?? {},
    is_active: true,
    last_synced_at: new Date().toISOString(),
  };

  let sourceId: string;

  if (src.external_id) {
    const { data: existing, error: existingErr } = await db
      .from("legal_sources")
      .select("id")
      .eq("connector", connector)
      .eq("external_id", src.external_id)
      .maybeSingle();

    if (existingErr) throw existingErr;

    if (existing?.id) {
      const { data: updated, error: updateErr } = await db
        .from("legal_sources")
        .update(sourcePayload)
        .eq("id", existing.id)
        .select("id")
        .single();

      if (updateErr) throw updateErr;
      sourceId = updated.id as string;
    } else {
      const { data: inserted, error: insertErr } = await db
        .from("legal_sources")
        .insert(sourcePayload)
        .select("id")
        .single();

      if (insertErr) throw insertErr;
      sourceId = inserted.id as string;
    }
  } else {
    const { data: inserted, error: insertErr } = await db
      .from("legal_sources")
      .insert(sourcePayload)
      .select("id")
      .single();

    if (insertErr) throw insertErr;
    sourceId = inserted.id as string;
  }

  // 2. Chunk
  const chunks = smartChunk(src.content, src.source_type);
  if (chunks.length === 0) return { source_id: sourceId, chunks: 0, promoted: false };

  // 3. STAGING path (when we have a job_id) — atomic swap via promote_ingestion_job
  if (jobId) {
    // Link source to job (so promote knows which source to swap)
    await db.from("ingestion_jobs").update({ source_id: sourceId }).eq("id", jobId);

    // Clear any prior staging rows for this job (defensive — re-runs)
    await db.from("legal_chunks_staging").delete().eq("job_id", jobId);

    // Embed + insert staging in batches
    const BATCH = 64;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const embeds = await embedTexts(apiKey, slice.map((c) => c.content));
      const rows = slice.map((c, idx) => ({
        job_id: jobId,
        source_id: sourceId,
        chunk_index: i + idx,
        heading: c.heading,
        content: c.content,
        embedding: embeds[idx] ?? null,
      }));
      const { error: stagErr } = await db.from("legal_chunks_staging").insert(rows);
      if (stagErr) throw stagErr;
    }

    // Atomic promote (deletes live chunks for source_id + inserts staging + clears staging)
    const { error: promErr } = await db.rpc("promote_ingestion_job", { p_job_id: jobId });
    if (promErr) throw promErr;

    return { source_id: sourceId, chunks: chunks.length, promoted: true };
  }

  // 4. LEGACY path (no job_id) — delete-then-insert (kept for ad-hoc seeding)
  const { error: delErr } = await db.from("legal_chunks").delete().eq("source_id", sourceId);
  if (delErr) throw delErr;

  const BATCH = 64;
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const embeds = await embedTexts(apiKey, slice.map((c) => c.content));
    slice.forEach((c, idx) => {
      rows.push({
        source_id: sourceId,
        chunk_index: i + idx,
        heading: c.heading,
        content: c.content,
        embedding: embeds[idx] ?? null,
      });
    });
  }
  const { error: insErr } = await db.from("legal_chunks").insert(rows);
  if (insErr) throw insErr;

  return { source_id: sourceId, chunks: rows.length, promoted: false };
}

// CORS helpers — re-exported from _shared/cors.ts (allowlist-based).
export { corsHeaders, corsHeadersFor } from "./cors.ts";
