// Shared ingestion helpers used by all connector edge functions.
// Handles: source upsert, chunking + embeddings batch, jobs tracking, error logging.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chunkText, embedTexts } from "./embeddings.ts";

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
 * Idempotent on (connector, external_id).
 */
export async function ingestSource(
  db: SupabaseClient,
  apiKey: string,
  connector: ConnectorName,
  src: SourceInput,
): Promise<{ source_id: string; chunks: number }> {
  // 1. Upsert source
  const { data: srcRow, error: upErr } = await db
    .from("legal_sources")
    .upsert({
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
    }, { onConflict: "connector,external_id" })
    .select("id")
    .single();
  if (upErr) throw upErr;
  const sourceId = srcRow.id as string;

  // 2. Replace existing chunks (simple strategy: delete-then-insert)
  const { error: delErr } = await db.from("legal_chunks").delete().eq("source_id", sourceId);
  if (delErr) throw delErr;

  // 3. Chunk
  const chunks = chunkText(src.content);
  if (chunks.length === 0) return { source_id: sourceId, chunks: 0 };

  // 4. Embed in batches of 64
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

  return { source_id: sourceId, chunks: rows.length };
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
