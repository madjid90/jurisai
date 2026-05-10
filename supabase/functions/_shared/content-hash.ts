// ============================================================================
// _shared/content-hash.ts — MAJ incrémentale par SHA-256. Économie ~95% LLM.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function shouldIngest(
  db: SupabaseClient,
  connector: string,
  externalId: string,
  newContentHash: string,
): Promise<{ shouldIngest: boolean; reason: "new" | "changed" | "unchanged" }> {
  const { data } = await db
    .from("legal_sources")
    .select("id, raw_metadata")
    .eq("connector", connector)
    .eq("external_id", externalId)
    .maybeSingle();

  if (!data) return { shouldIngest: true, reason: "new" };

  const existingHash = (data.raw_metadata as { content_hash?: string } | null)?.content_hash;
  if (existingHash === newContentHash) {
    return { shouldIngest: false, reason: "unchanged" };
  }
  return { shouldIngest: true, reason: "changed" };
}
