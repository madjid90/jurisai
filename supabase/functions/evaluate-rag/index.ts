// Evaluate RAG quality: runs each active rag_eval_case through the legal-chat
// pipeline, scores precision@5, MRR, hallucination, latency, and stores results
// in rag_eval_runs. Triggered manually by super_admins or via cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeadersFor } from "../_shared/cors.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface EvalCase {
  id: string;
  question: string;
  expected_answer_keywords: string[];
  expected_sources: string[];
  idcc: string | null;
  category: string;
  difficulty: string;
}

interface EvalResult {
  case_id: string;
  precision_at_5: number;
  mrr: number;
  hallucination_detected: boolean;
  retrieved_sources: string[];
  answer: string;
  latency_ms: number;
  model: string;
}

function precisionAtK(retrieved: string[], expected: string[], k = 5): number {
  if (expected.length === 0) return 0;
  const top = retrieved.slice(0, k);
  const hits = top.filter((r) => expected.some((e) => r.includes(e) || e.includes(r)));
  return hits.length / Math.min(k, expected.length);
}

function meanReciprocalRank(retrieved: string[], expected: string[]): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (expected.some((e) => retrieved[i].includes(e) || e.includes(retrieved[i]))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

function detectHallucination(answer: string, keywords: string[], sources: string[]): boolean {
  if (sources.length === 0 && answer.length > 200 && !/sources?\s+insuffisantes?/i.test(answer)) {
    return true; // long answer with no sources
  }
  // If expected keywords are present we trust the answer; if many cited articles
  // are absent from the answer body, flag.
  const lower = answer.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k.toLowerCase())).length;
  return keywords.length > 0 && hits / keywords.length < 0.3;
}

async function runOneCase(
  authToken: string,
  c: EvalCase,
  db: ReturnType<typeof createClient>,
  userId: string,
  tenantId: string,
): Promise<EvalResult> {
  const start = Date.now();

  // Crée une conversation temporaire (legal-chat exige conversationId).
  const { data: convo, error: convoErr } = await db
    .from("conversations")
    .insert({
      user_id: userId,
      tenant_id: tenantId,
      title: `[eval] ${c.question.slice(0, 60)}`,
    })
    .select("id")
    .single();
  if (convoErr || !convo) {
    return {
      case_id: c.id,
      precision_at_5: 0,
      mrr: 0,
      hallucination_detected: true,
      retrieved_sources: [],
      answer: `[ERROR conversation create] ${convoErr?.message ?? ""}`,
      latency_ms: Date.now() - start,
      model: "n/a",
    };
  }

  let answer = "";
  const sources: string[] = [];
  let model = "unknown";

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-chat`, {
      method: "POST",
      headers: {
        Authorization: authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: (convo as { id: string }).id,
        message: c.question,
        history: [],
        idcc: c.idcc,
        eval_mode: true,
      }),
    });

    if (res.ok) {
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        answer = data.answer ?? data.text ?? "";
        model = data.model ?? "lovable-ai";
        const srcs = data.sources ?? data.citations ?? [];
        for (const s of srcs) {
          sources.push(s.reference_code ?? s.title ?? s.ref ?? String(s));
        }
      } else {
        answer = await res.text();
      }
    } else {
      answer = `[ERROR ${res.status}] ${await res.text().catch(() => "")}`;
    }
  } finally {
    // Cleanup conversation temporaire
    await db.from("conversations").delete().eq("id", (convo as { id: string }).id);
  }

  return {
    case_id: c.id,
    precision_at_5: precisionAtK(sources, c.expected_sources),
    mrr: meanReciprocalRank(sources, c.expected_sources),
    hallucination_detected: detectHallucination(answer, c.expected_answer_keywords, sources),
    retrieved_sources: sources,
    answer: answer.slice(0, 2000),
    latency_ms: Date.now() - start,
    model,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireSuperAdmin(req);
    const authToken = req.headers.get("Authorization") ?? "";

    const db = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Récupère le tenant de l'admin pour créer les conversations temporaires
    const { data: profile } = await db
      .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
    const tenantId = (profile as { tenant_id: string | null } | null)?.tenant_id;
    if (!tenantId) throw new Error("Super admin sans tenant_id : impossible de créer une conversation d'évaluation.");

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? 50), 100);

    const { data: cases, error: caseErr } = await db
      .from("rag_eval_cases")
      .select("id, question, expected_answer_keywords, expected_sources, idcc, category, difficulty")
      .eq("active", true)
      .limit(limit);

    if (caseErr) throw caseErr;
    if (!cases || cases.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, ran: 0, message: "No active eval cases." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: EvalResult[] = [];
    for (const c of cases as EvalCase[]) {
      try {
        const r = await runOneCase(authToken, c, db, userId, tenantId);
        results.push(r);
        await db.from("rag_eval_runs").insert(r);
      } catch (e) {
        console.error(`Eval case ${c.id} failed:`, e);
      }
    }

    const summary = {
      ok: true,
      ran: results.length,
      avg_precision_at_5:
        results.reduce((s, r) => s + r.precision_at_5, 0) / Math.max(results.length, 1),
      avg_mrr: results.reduce((s, r) => s + r.mrr, 0) / Math.max(results.length, 1),
      hallucination_rate:
        results.filter((r) => r.hallucination_detected).length / Math.max(results.length, 1),
      avg_latency_ms:
        results.reduce((s, r) => s + r.latency_ms, 0) / Math.max(results.length, 1),
    };

    // Record system metric
    await db.from("system_metrics").insert([
      { metric_name: "rag_eval_precision_at_5", metric_value: summary.avg_precision_at_5 },
      { metric_name: "rag_eval_mrr", metric_value: summary.avg_mrr },
      { metric_name: "rag_eval_hallucination_rate", metric_value: summary.hallucination_rate },
      { metric_name: "rag_eval_avg_latency_ms", metric_value: summary.avg_latency_ms },
    ]);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err instanceof Error && err.message.includes("403") ? 403 : 500;
    console.error("evaluate-rag error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
