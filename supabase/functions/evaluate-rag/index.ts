// Evaluate RAG quality: runs each active rag_eval_case through the legal-chat
// pipeline, scores precision@5, MRR, hallucination, latency, and stores results
// in rag_eval_runs. Triggered manually by super_admins or via cron.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ─── CORS inline ───────────────────────────────────────────────────
const DEFAULT_ALLOWED = [
  "https://id-preview--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app",
  "https://07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovableproject.com",
  "https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app",
  "https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0-dev.lovable.app",
  "http://localhost:3000", "http://localhost:5173", "http://localhost:8080",
];
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const extra = (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = [...new Set([...DEFAULT_ALLOWED, ...extra])];
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// ─── Auth inline (requireSuperAdmin) ────────────────────────────────
class AuthError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }
async function requireSuperAdmin(req: Request): Promise<{ userId: string; admin: SupabaseClient }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new AuthError("Missing Authorization", 401);
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const SUPABASE_URL_ = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY_ = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(SUPABASE_URL_, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error } = await userClient.auth.getUser(token);
  if (error || !u.user) throw new AuthError("Invalid session", 401);
  const admin = createClient(SUPABASE_URL_, SERVICE_KEY_, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: role, error: rErr } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "super_admin").maybeSingle();
  if (rErr) throw new AuthError(`Role check: ${rErr.message}`, 500);
  if (!role) throw new AuthError("Forbidden: super_admin required", 403);
  return { userId: u.user.id, admin };
}

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
  retrieval_accuracy: number;
  citation_coverage: number;
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

// ─── Parser SSE pour legal-chat (text/event-stream) ─────────────────────────
// Format : `event: <name>\ndata: <json>\n\n`
// Events possibles : `sources`, `model`, `token`, `done`, `error`.
type ParsedSse = {
  answer: string;
  model: string;
  sources: Array<Record<string, unknown>>;
  citationCoverage: number; // ratio [source:N] cités dans la réponse vs sources fournies
};

function parseSseStream(text: string): ParsedSse {
  const blocks = text.split(/\n\n+/);
  let answer = "";
  let model = "unknown";
  const sources: Array<Record<string, unknown>> = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    let eventName = "message";
    const dataParts: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataParts.push(line.slice(5).trim());
    }
    if (dataParts.length === 0) continue;
    const raw = dataParts.join("\n");

    if (eventName === "sources") {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) sources.push(...arr);
      } catch { /* skip */ }
    } else if (eventName === "model") {
      try {
        const parsed = JSON.parse(raw);
        model = typeof parsed === "string" ? parsed : String(parsed.model ?? parsed);
      } catch { model = raw.replace(/^["']|["']$/g, ""); }
    } else if (eventName === "token" || eventName === "message") {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string") answer += parsed;
        else if (parsed && typeof parsed === "object") {
          if (typeof parsed.token === "string") answer += parsed.token;
          else if (typeof parsed.text === "string") answer += parsed.text;
          else if (typeof parsed.content === "string") answer += parsed.content;
        }
      } catch { answer += raw; }
    } else if (eventName === "done") {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.answer === "string" && !answer) answer = parsed.answer;
          if (typeof parsed.model === "string") model = parsed.model;
          if (Array.isArray(parsed.sources)) sources.push(...parsed.sources);
        }
      } catch { /* skip */ }
    }
  }

  // Calcul couverture citations [source:N]
  const citedNumbers = new Set<number>();
  const re = /\[source:(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) citedNumbers.add(Number(m[1]));
  const citationCoverage = sources.length > 0 ? citedNumbers.size / sources.length : 0;

  return { answer, model, sources, citationCoverage };
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
      retrieval_accuracy: 0,
      citation_coverage: 0,
      hallucination_detected: true,
      retrieved_sources: [],
      answer: `[ERROR conversation create] ${convoErr?.message ?? ""}`,
      latency_ms: Date.now() - start,
      model: "n/a",
    };
  }

  let answer = "";
  let sources: string[] = [];
  let model = "unknown";
  let citationCoverage = 0;

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
      const rawBody = await res.text();
      if (ct.includes("application/json")) {
        // Cas non-streaming (peu probable mais sûr)
        try {
          const data = JSON.parse(rawBody);
          answer = data.answer ?? data.text ?? "";
          model = data.model ?? "lovable-ai";
          const srcs: Array<Record<string, unknown>> = data.sources ?? data.citations ?? [];
          sources = srcs.map((s) =>
            String(s.reference_code ?? s.title ?? s.ref ?? ""),
          );
        } catch {
          answer = rawBody;
        }
      } else {
        // SSE streaming (cas nominal de legal-chat)
        const parsed = parseSseStream(rawBody);
        answer = parsed.answer;
        model = parsed.model;
        sources = parsed.sources.map((s) =>
          String(s.reference_code ?? s.title ?? s.ref ?? s.reference ?? ""),
        ).filter(Boolean);
        citationCoverage = parsed.citationCoverage;
      }
    } else {
      answer = `[ERROR ${res.status}] ${await res.text().catch(() => "")}`;
    }
  } finally {
    // Cleanup conversation temporaire
    await db.from("conversations").delete().eq("id", (convo as { id: string }).id);
  }

  const p5 = precisionAtK(sources, c.expected_sources);
  return {
    case_id: c.id,
    precision_at_5: p5,
    mrr: meanReciprocalRank(sources, c.expected_sources),
    // retrieval_accuracy = au moins une source attendue dans le top-5
    retrieval_accuracy: c.expected_sources.length > 0 && p5 > 0 ? 1 : 0,
    citation_coverage: citationCoverage,
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

    // Exécution en arrière-plan : évite le timeout 150s de l'edge function.
    // On répond immédiatement, le batch continue côté serveur.
    const runBatch = async () => {
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
      const n = Math.max(results.length, 1);
      const summary = {
        ran: results.length,
        avg_precision_at_5: results.reduce((s, r) => s + r.precision_at_5, 0) / n,
        avg_mrr: results.reduce((s, r) => s + r.mrr, 0) / n,
        avg_retrieval_accuracy: results.reduce((s, r) => s + r.retrieval_accuracy, 0) / n,
        avg_citation_coverage: results.reduce((s, r) => s + r.citation_coverage, 0) / n,
        hallucination_rate: results.filter((r) => r.hallucination_detected).length / n,
        avg_latency_ms: results.reduce((s, r) => s + r.latency_ms, 0) / n,
      };
      await db.from("system_metrics").insert([
        { metric_name: "rag_eval_precision_at_5", metric_value: summary.avg_precision_at_5 },
        { metric_name: "rag_eval_mrr", metric_value: summary.avg_mrr },
        { metric_name: "rag_eval_retrieval_accuracy", metric_value: summary.avg_retrieval_accuracy },
        { metric_name: "rag_eval_citation_coverage", metric_value: summary.avg_citation_coverage },
        { metric_name: "rag_eval_hallucination_rate", metric_value: summary.hallucination_rate },
        { metric_name: "rag_eval_avg_latency_ms", metric_value: summary.avg_latency_ms },
      ]);
      console.log("[evaluate-rag] batch done", summary);
    };

    // @ts-expect-error EdgeRuntime global fourni par Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-expect-error EdgeRuntime global
      EdgeRuntime.waitUntil(runBatch());
    } else {
      void runBatch();
    }

    return new Response(
      JSON.stringify({
        ok: true,
        queued: cases.length,
        message: `Évaluation lancée en arrière-plan sur ${cases.length} cas. Rafraîchissez dans 1-2 min.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const status = err instanceof Error && err.message.includes("403") ? 403 : 500;
    console.error("evaluate-rag error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
