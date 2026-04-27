// Edge function: legal-agent (tool calling / agentic mode)
// The LLM can iteratively call tools to:
//  - search_law(query, idcc?) → RAG search in legal_chunks
//  - list_dossiers(status?, limit?) → list user's dossiers
//  - create_task(dossier_id, title, priority?, due_at?) → create a task
//  - create_deadline(dossier_id, title, due_at) → create a deadline
//
// Returns a JSON object with the final answer + a trace of tool calls.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CHAT_MODEL = "google/gemini-3-flash-preview";
const EMBED_MODEL = "openai/text-embedding-3-small";
const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT = `Tu es **JurisAI Agent**, assistant agentique pour juristes français.

Tu peux appeler des outils pour rechercher dans les sources juridiques, lister les dossiers du cabinet, créer des tâches ou des échéances. Utilise les outils intelligemment :
- Avant toute affirmation juridique, appelle \`search_law\` pour récupérer les sources officielles.
- Cite tes sources via [source:N] où N est le numéro retourné par search_law.
- N'utilise create_task / create_deadline que si l'utilisateur en fait la demande explicite.
- Réponds en français, ton professionnel.

Date courante : 2026.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_law",
      description: "Recherche dans la base juridique (Code du travail, conventions collectives, jurisprudence). Retourne les passages les plus pertinents avec leurs références.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Question ou mots-clés à rechercher" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dossiers",
      description: "Liste les dossiers du cabinet de l'utilisateur.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filtre statut optionnel (ex: open, closed)" },
          limit: { type: "number", description: "Nombre max (défaut 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Crée une tâche dans un dossier.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          title: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          due_at: { type: "string", description: "Date ISO 8601 optionnelle" },
        },
        required: ["dossier_id", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_deadline",
      description: "Crée une échéance dans un dossier.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          title: { type: "string" },
          due_at: { type: "string", description: "Date ISO 8601" },
        },
        required: ["dossier_id", "title", "due_at"],
      },
    },
  },
];

interface AgentContext {
  supabase: SupabaseClient;
  userId: string;
  tenantId: string;
  idcc: string | null;
  apiKey: string;
  sourcesRegistry: Array<{ n: number; title: string; ref: string | null; url: string | null }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonErr("Missing env", 500);
    }

    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing authorization", 401);
    const accessToken = auth.replace(/^Bearer\s+/i, "");

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(accessToken);
    if (userErr || !userData.user) return jsonErr("Invalid session", 401);
    const userId = userData.user.id;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile } = await supabase
      .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
    const tenantId = (profile as { tenant_id: string | null } | null)?.tenant_id;
    if (!tenantId) return jsonErr("No tenant", 403);

    const { data: tenant } = await supabase
      .from("tenants").select("idcc").eq("id", tenantId).maybeSingle();
    const idcc = (tenant as { idcc: string | null } | null)?.idcc ?? null;

    // Rate limit
    const { data: rl } = await supabase.rpc("check_rate_limit", {
      p_user_id: userId, p_endpoint: "legal-agent", p_max_per_minute: 5,
    });
    if (Array.isArray(rl) && rl[0] && !rl[0].allowed) {
      return jsonErr("Trop de requêtes (5/min).", 429);
    }

    // Quota
    const { data: quotaOk } = await supabase.rpc("increment_questions_used", {
      _tenant_id: tenantId,
    });
    if (!quotaOk) return jsonErr("Quota mensuel atteint.", 402);

    const body = await req.json();
    const message: string = (body.message ?? "").toString().slice(0, 4000);
    if (!message.trim()) return jsonErr("Message vide", 400);

    const ctx: AgentContext = {
      supabase, userId, tenantId, idcc,
      apiKey: LOVABLE_API_KEY,
      sourcesRegistry: [],
    };

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: message },
    ];
    const trace: Array<{ tool: string; args: unknown; result: unknown }> = [];

    let final = "";
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: CHAT_MODEL, messages, tools: TOOLS, tool_choice: "auto" }),
      });
      if (!res.ok) {
        if (res.status === 429) return jsonErr("Trop de requêtes IA", 429);
        if (res.status === 402) return jsonErr("Crédits IA épuisés", 402);
        const errText = await res.text();
        console.error("AI gateway error", res.status, errText);
        return jsonErr("Erreur IA", 500);
      }
      const json = await res.json();
      const choice = json.choices?.[0];
      const msg = choice?.message;
      if (!msg) return jsonErr("Réponse IA invalide", 500);

      messages.push(msg);

      const toolCalls = msg.tool_calls as Array<{
        id: string;
        function: { name: string; arguments: string };
      }> | undefined;

      if (!toolCalls || toolCalls.length === 0) {
        final = (msg.content ?? "").toString();
        break;
      }

      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* noop */ }
        const result = await runTool(call.function.name, args, ctx);
        trace.push({ tool: call.function.name, args, result });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 8000),
        });
      }
    }

    // Audit
    await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      action: "agent.run",
      resource_type: "agent",
      metadata: { tool_calls: trace.map(t => t.tool), message_len: message.length },
    });

    return new Response(
      JSON.stringify({
        answer: final || "(L'agent n'a pas pu finaliser la réponse — réessayez.)",
        sources: ctx.sourcesRegistry,
        trace,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("legal-agent error:", e);
    return jsonErr(e instanceof Error ? e.message : "Unknown", 500);
  }
});

async function runTool(name: string, args: Record<string, unknown>, ctx: AgentContext) {
  try {
    if (name === "search_law") return await toolSearchLaw(args, ctx);
    if (name === "list_dossiers") return await toolListDossiers(args, ctx);
    if (name === "create_task") return await toolCreateTask(args, ctx);
    if (name === "create_deadline") return await toolCreateDeadline(args, ctx);
    return { error: "Unknown tool" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "tool error" };
  }
}

async function toolSearchLaw(args: Record<string, unknown>, ctx: AgentContext) {
  const query = String(args.query ?? "").slice(0, 500);
  if (!query.trim()) return { error: "Empty query" };

  const embRes = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: [query] }),
  });
  if (!embRes.ok) return { error: "embedding failed" };
  const embJson = await embRes.json();
  const embedding: number[] = embJson.data?.[0]?.embedding ?? [];
  if (!embedding.length) return { error: "no embedding" };

  const { data: results } = await ctx.supabase.rpc("hybrid_search", {
    query_embedding: embedding as unknown as string,
    query_text: query,
    match_count: 6,
    idcc_filter: ctx.idcc,
  });
  const chunks = (results ?? []) as Array<{
    chunk_id: string; source_title: string; reference_code: string | null;
    official_url: string | null; content: string;
  }>;

  return {
    sources: chunks.map((c) => {
      const n = ctx.sourcesRegistry.length + 1;
      ctx.sourcesRegistry.push({
        n, title: c.source_title, ref: c.reference_code, url: c.official_url,
      });
      return {
        n, title: c.source_title, reference: c.reference_code,
        url: c.official_url, excerpt: c.content.slice(0, 800),
      };
    }),
  };
}

async function toolListDossiers(args: Record<string, unknown>, ctx: AgentContext) {
  const limit = Math.min(Number(args.limit) || 20, 50);
  let q = ctx.supabase
    .from("dossiers")
    .select("id, title, status, created_at")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (typeof args.status === "string") q = q.eq("status", args.status);
  const { data, error } = await q;
  if (error) return { error: error.message };
  return { dossiers: data ?? [] };
}

async function toolCreateTask(args: Record<string, unknown>, ctx: AgentContext) {
  const dossier_id = String(args.dossier_id ?? "");
  const title = String(args.title ?? "").slice(0, 200);
  if (!dossier_id || !title) return { error: "dossier_id et title requis" };

  const { data: d } = await ctx.supabase
    .from("dossiers").select("id").eq("id", dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!d) return { error: "Dossier introuvable" };

  const { data, error } = await (ctx.supabase as any)
    .from("dossier_tasks")
    .insert({
      tenant_id: ctx.tenantId,
      dossier_id,
      title,
      priority: typeof args.priority === "string" ? args.priority : "medium",
      due_at: typeof args.due_at === "string" ? args.due_at : null,
      created_by: ctx.userId,
      status: "todo",
    })
    .select("id, title, priority, due_at")
    .single();
  if (error) return { error: error.message };
  return { task: data };
}

async function toolCreateDeadline(args: Record<string, unknown>, ctx: AgentContext) {
  const dossier_id = String(args.dossier_id ?? "");
  const title = String(args.title ?? "").slice(0, 200);
  const due_at = String(args.due_at ?? "");
  if (!dossier_id || !title || !due_at) return { error: "champs requis manquants" };

  const { data: d } = await ctx.supabase
    .from("dossiers").select("id").eq("id", dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!d) return { error: "Dossier introuvable" };

  const { data, error } = await (ctx.supabase as any)
    .from("deadlines")
    .insert({ tenant_id: ctx.tenantId, dossier_id, title, due_at })
    .select("id, title, due_at")
    .single();
  if (error) return { error: error.message };
  return { deadline: data };
}

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
