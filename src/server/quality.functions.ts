// Server functions admin pour la qualité production (Priorité 8).
// Toutes accessibles uniquement aux super_admins.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireSuperAdmin(userId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden — super_admin only");
}

export type DataQualitySnapshot = {
  sources_total: number;
  sources_active: number;
  sources_stale: number;
  chunks_total: number;
  chunks_without_embedding: number;
  orphan_chunks: number;
  ingestion_failed_24h: number;
  avg_authority_level: number | null;
  generated_at: string;
};

export const getDataQualitySnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DataQualitySnapshot> => {
    const { userId } = context as { userId: string };
    await requireSuperAdmin(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabaseAdmin.rpc("get_data_quality_snapshot");
    if (error) throw new Error(error.message);
    return data as DataQualitySnapshot;
  });

export type ServerErrorRow = {
  id: string;
  function_name: string;
  user_id: string | null;
  tenant_id: string | null;
  error_message: string;
  error_stack: string | null;
  context: Record<string, NonNullable<unknown>>;
  severity: "warn" | "error" | "critical";
  created_at: string;
};

export const listServerErrors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        limit: z.number().int().min(1).max(500).optional(),
        functionName: z.string().optional(),
        severity: z.enum(["warn", "error", "critical"]).optional(),
        sinceHours: z.number().int().min(1).max(24 * 30).optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await requireSuperAdmin(userId);
    const limit = data.limit ?? 100;
    const sinceHours = data.sinceHours ?? 72;
    const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = supabaseAdmin
      .from("server_function_errors")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data.functionName) q = q.eq("function_name", data.functionName);
    if (data.severity) q = q.eq("severity", data.severity);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Agrégat par fonction
    const byFunction = new Map<string, number>();
    for (const r of (rows ?? []) as ServerErrorRow[]) {
      byFunction.set(r.function_name, (byFunction.get(r.function_name) ?? 0) + 1);
    }
    const topFunctions = [...byFunction.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    return {
      rows: (rows ?? []) as ServerErrorRow[],
      topFunctions,
      total: rows?.length ?? 0,
      sinceHours,
    };
  });

export type RagEvalAggregate = {
  total_runs: number;
  avg_precision_at_5: number;
  avg_mrr: number;
  avg_retrieval_accuracy: number | null;
  avg_citation_coverage: number | null;
  avg_answer_correctness: number | null;
  avg_source_authority: number | null;
  avg_refusal_quality: number | null;
  avg_user_feedback: number | null;
  hallucination_rate: number;
  avg_latency_ms: number;
};

export const getRagEvalAggregate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RagEvalAggregate> => {
    const { userId } = context as { userId: string };
    await requireSuperAdmin(userId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabaseAdmin
      .from("rag_eval_runs")
      .select(
        "precision_at_5, mrr, retrieval_accuracy, citation_coverage, answer_correctness, source_authority_score, refusal_quality, user_feedback_score, hallucination_detected, latency_ms",
      )
      .order("ran_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<Record<string, number | boolean | null>>;
    const n = rows.length || 1;
    const avg = (k: string): number => {
      let s = 0;
      let c = 0;
      for (const r of rows) {
        const v = r[k];
        if (typeof v === "number" && !Number.isNaN(v)) {
          s += v;
          c++;
        }
      }
      return c ? s / c : 0;
    };
    const avgN = (k: string): number | null => {
      let s = 0;
      let c = 0;
      for (const r of rows) {
        const v = r[k];
        if (typeof v === "number" && !Number.isNaN(v)) {
          s += v;
          c++;
        }
      }
      return c ? s / c : null;
    };

    const halluCount = rows.filter((r) => r.hallucination_detected === true).length;

    return {
      total_runs: rows.length,
      avg_precision_at_5: avg("precision_at_5"),
      avg_mrr: avg("mrr"),
      avg_retrieval_accuracy: avgN("retrieval_accuracy"),
      avg_citation_coverage: avgN("citation_coverage"),
      avg_answer_correctness: avgN("answer_correctness"),
      avg_source_authority: avgN("source_authority_score"),
      avg_refusal_quality: avgN("refusal_quality"),
      avg_user_feedback: avgN("user_feedback_score"),
      hallucination_rate: rows.length ? halluCount / n : 0,
      avg_latency_ms: avg("latency_ms"),
    };
  });
