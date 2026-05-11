// ============================================================================
// _shared/batch-state.ts — Wrapper TS pour les RPC SQL de checkpoint batch.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export async function startBatch(
  db: SupabaseClient,
  connector: string,
  batchType: string,
  items: unknown[],
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await db.rpc("start_ingestion_batch", {
    p_connector: connector,
    p_batch_type: batchType,
    p_items: items,
    p_metadata: metadata,
  });
  if (error) throw new Error(`startBatch failed: ${error.message}`);
  return data as string;
}

export async function getNextItems<T = unknown>(
  db: SupabaseClient,
  batchId: string,
  limit: number,
): Promise<T[]> {
  const { data, error } = await db.rpc("get_next_batch_items", {
    p_batch_id: batchId,
    p_limit: limit,
  });
  if (error) throw new Error(`getNextItems failed: ${error.message}`);
  return (data as T[]) ?? [];
}

export async function heartbeat(
  db: SupabaseClient,
  batchId: string,
): Promise<void> {
  const { error } = await db.rpc("heartbeat_batch", { p_batch_id: batchId });
  if (error) console.warn(`heartbeat warning: ${error.message}`);
}

export async function markProcessed(
  db: SupabaseClient,
  batchId: string,
  processedItems: unknown[],
  articlesIngested = 0,
  articlesSkipped = 0,
): Promise<void> {
  if (processedItems.length === 0) return;
  const { error } = await db.rpc("mark_items_processed", {
    p_batch_id: batchId,
    p_processed_items: processedItems,
    p_articles_ingested: articlesIngested,
    p_articles_skipped: articlesSkipped,
  });
  if (error) throw new Error(`markProcessed failed: ${error.message}`);
}

export async function markFailed(
  db: SupabaseClient,
  batchId: string,
  failedItems: unknown[],
  errorMessage: string,
): Promise<void> {
  if (failedItems.length === 0) return;
  const { error } = await db.rpc("mark_items_failed", {
    p_batch_id: batchId,
    p_failed_items: failedItems,
    p_error_message: errorMessage,
  });
  if (error) console.error(`markFailed warning: ${error.message}`);
}

export interface BatchFinalResult {
  status: "completed" | "failed" | "paused";
  processed: number;
  failed: number;
  total: number;
  articles_ingested: number;
}

export async function finalizeBatch(
  db: SupabaseClient,
  batchId: string,
): Promise<BatchFinalResult> {
  const { data, error } = await db.rpc("finalize_batch", { p_batch_id: batchId });
  if (error) throw new Error(`finalizeBatch failed: ${error.message}`);
  return data as BatchFinalResult;
}
