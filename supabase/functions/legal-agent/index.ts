// Edge function: legal-agent (JurisAI agent transverse)
// Routeur d'intentions multi-domaines : RH, commercial, sociétés, RGPD, fiscal, contentieux, administratif.
// Logique : Comprendre → Sourcer (RAG obligatoire) → Proposer → Préparer → Valider → Exécuter → Archiver → Suivre → Alerter.
//
// Outils disponibles :
//  - classify_intent(message) → { intent, domain, confidence, requires_sources }
//  - search_law(query, domain?) → RAG dans legal_chunks
//  - search_dossier_context(dossier_id) → résumé dossier (timeline + tâches + risques)
//  - list_dossiers(status?, domain?, limit?)
//  - propose_document(dossier_id, doc_type, params) → crée une session de génération
//  - identify_risk(dossier_id, title, severity, legal_basis)
//  - request_validation(dossier_id, action_type, payload, validators)
//  - schedule_reminder(dossier_id, title, remind_at)
//  - create_task(dossier_id, title, priority?, due_date?)
//  - create_deadline(dossier_id, title, due_date)
//  - log_timeline(dossier_id, event_type, summary, payload?)

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { corsHeadersFor } from "../_shared/cors.ts";
const CHAT_MODEL = "google/gemini-3-flash-preview";
const EMBED_MODEL = "openai/text-embedding-3-small";
const MAX_TOOL_ROUNDS = 8;

const SYSTEM_PROMPT = `Tu es **JurisAI**, copilote juridique pour cabinets d'avocats et juristes français. Tu n'es PAS spécialisé RH : tu couvres l'ensemble des domaines du droit pertinents pour un cabinet :
- Droit social / RH (contrats de travail, conventions collectives, ruptures, CSE…)
- Droit commercial (contrats commerciaux, baux, distribution, CGV/CGU…)
- Droit des sociétés (constitution, AG, cessions, gouvernance…)
- RGPD / données personnelles
- Fiscalité courante (TVA, fiscalité des sociétés simple)
- Réglementation métier (selon secteur du client)
- Contentieux (préparation actes, conclusions, suivi procédural)
- Administratif (autorisations, déclarations)

## Logique fondamentale (à appliquer SYSTÉMATIQUEMENT)
1. **Comprendre** — Reformule l'intention. Appelle \`classify_intent\` au début si la demande est ambiguë.
2. **Sourcer** — Pour TOUTE affirmation juridique, appelle \`search_law\`. Cite via [source:N]. Si tu n'as pas de source pertinente sur un point sensible, **refuse de répondre** et propose à l'utilisateur de préciser ou de fournir le contrat / la convention applicable.
3. **Proposer** — Suggère 1 à 3 actions concrètes (document à générer, risque identifié, échéance, validation à demander).
4. **Préparer** — Si l'utilisateur valide, utilise \`propose_document\`, \`identify_risk\`, \`schedule_reminder\`, \`create_task\`, \`create_deadline\`.
5. **Valider** — Pour toute action engageante (envoi à un tiers, signature, document final), appelle \`request_validation\`.
6. **Archiver / Suivre** — Toute action significative sur un dossier doit être tracée via \`log_timeline\`.
7. **Alerter** — Identifie les risques (\`identify_risk\`) et les échéances réglementaires.

## Règles de comportement
- Réponds en français, ton professionnel et précis.
- Jamais d'invention juridique. Pas de source = pas d'affirmation.
- Pour les décisions sensibles (licenciement, rupture conventionnelle, contentieux, dépôt légal), insiste sur la validation humaine.
- N'utilise les outils de création (task, deadline, document, validation) que si l'utilisateur le demande explicitement OU si c'est une étape évidente du workflow en cours.
- Si la demande sort du périmètre juridique, redirige poliment.

Date courante : 2026.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "classify_intent",
      description: "Classifie l'intention de l'utilisateur et le domaine juridique. Appelle cet outil EN PREMIER si la demande est ambiguë ou complexe.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_law",
      description: "Recherche RAG dans les sources juridiques officielles (codes, conventions collectives, jurisprudence, textes RGPD…). À appeler avant toute affirmation juridique.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          domain: {
            type: "string",
            enum: ["rh", "commercial", "societes", "rgpd", "fiscal", "contentieux", "administratif", "general"],
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_dossier_context",
      description: "Récupère le contexte d'un dossier : timeline, tâches ouvertes, risques identifiés, échéances.",
      parameters: {
        type: "object",
        properties: { dossier_id: { type: "string" } },
        required: ["dossier_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dossiers",
      description: "Liste les dossiers du cabinet, filtrables par statut ou domaine.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string" },
          domain: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_document",
      description: "Initie une session de génération de document (contrat, lettre, conclusions, PV d'AG, registre RGPD…).",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          doc_type: { type: "string", description: "Ex: contrat_travail_cdi, lettre_licenciement, pv_ag, registre_traitement_rgpd, mise_en_demeure…" },
          domain: { type: "string" },
          params: { type: "object", description: "Paramètres préliminaires" },
        },
        required: ["dossier_id", "doc_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "identify_risk",
      description: "Enregistre un risque juridique identifié sur un dossier.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          title: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          legal_basis: { type: "string", description: "Article / source justifiant le risque" },
          description: { type: "string" },
        },
        required: ["dossier_id", "title", "severity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_validation",
      description: "Crée une demande de validation hiérarchique avant exécution d'une action engageante.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          action_type: { type: "string" },
          payload: { type: "object" },
          reason: { type: "string" },
        },
        required: ["dossier_id", "action_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_reminder",
      description: "Programme un rappel pour l'utilisateur à une date donnée.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          title: { type: "string" },
          remind_at: { type: "string", description: "ISO 8601" },
          channel: { type: "string", enum: ["in_app", "email"] },
        },
        required: ["title", "remind_at"],
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
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
          due_date: { type: "string" },
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
          due_date: { type: "string" },
        },
        required: ["dossier_id", "title", "due_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_timeline",
      description: "Trace un événement métier sur la timeline du dossier.",
      parameters: {
        type: "object",
        properties: {
          dossier_id: { type: "string" },
          event_type: { type: "string" },
          summary: { type: "string" },
          payload: { type: "object" },
        },
        required: ["dossier_id", "event_type", "summary"],
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
  intent: { intent: string; domain: string; confidence: number } | null;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const jsonErr = (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

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

    const { data: rl } = await supabase.rpc("check_rate_limit", {
      p_user_id: userId, p_endpoint: "legal-agent", p_max_per_minute: 5,
    });
    if (Array.isArray(rl) && rl[0] && !rl[0].allowed) {
      return jsonErr("Trop de requêtes (5/min).", 429);
    }

    const { data: quotaOk } = await supabase.rpc("increment_questions_used", {
      _tenant_id: tenantId,
    });
    if (!quotaOk) return jsonErr("Quota mensuel atteint.", 402);

    const body = await req.json();
    const message: string = (body.message ?? "").toString().slice(0, 4000);
    const dossierIdHint: string | null = body.dossier_id ? String(body.dossier_id) : null;
    if (!message.trim()) return jsonErr("Message vide", 400);

    const ctx: AgentContext = {
      supabase, userId, tenantId, idcc,
      apiKey: LOVABLE_API_KEY,
      sourcesRegistry: [],
      intent: null,
    };

    const userPreamble = dossierIdHint
      ? `[Contexte dossier : ${dossierIdHint}]\n${message}`
      : message;

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPreamble },
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

    await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      action: "agent.run",
      resource_type: "agent",
      metadata: {
        intent: ctx.intent,
        tool_calls: trace.map(t => t.tool),
        message_len: message.length,
        sources_count: ctx.sourcesRegistry.length,
      },
    });

    return new Response(
      JSON.stringify({
        answer: final || "(L'agent n'a pas pu finaliser la réponse — réessayez.)",
        intent: ctx.intent,
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
    switch (name) {
      case "classify_intent": return await toolClassifyIntent(args, ctx);
      case "search_law": return await toolSearchLaw(args, ctx);
      case "search_dossier_context": return await toolDossierContext(args, ctx);
      case "list_dossiers": return await toolListDossiers(args, ctx);
      case "propose_document": return await toolProposeDocument(args, ctx);
      case "identify_risk": return await toolIdentifyRisk(args, ctx);
      case "request_validation": return await toolRequestValidation(args, ctx);
      case "schedule_reminder": return await toolScheduleReminder(args, ctx);
      case "create_task": return await toolCreateTask(args, ctx);
      case "create_deadline": return await toolCreateDeadline(args, ctx);
      case "log_timeline": return await toolLogTimeline(args, ctx);
      default: return { error: "Unknown tool" };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "tool error" };
  }
}

async function toolClassifyIntent(args: Record<string, unknown>, ctx: AgentContext) {
  const msg = String(args.message ?? "").slice(0, 2000);
  if (!msg.trim()) return { error: "empty" };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: "Tu classifies des demandes juridiques. Réponds en JSON strict {intent, domain, confidence, requires_sources, reasoning}. domain ∈ [rh, commercial, societes, rgpd, fiscal, contentieux, administratif, general]. intent ∈ [question_juridique, redaction_document, analyse_document, gestion_dossier, suivi_echeance, conformite, autre]. confidence ∈ [0,1]." },
        { role: "user", content: msg },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return { error: "classification failed" };
  const j = await res.json();
  try {
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
    ctx.intent = {
      intent: String(parsed.intent ?? "autre"),
      domain: String(parsed.domain ?? "general"),
      confidence: Number(parsed.confidence ?? 0),
    };
    return parsed;
  } catch {
    return { error: "parse error" };
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

  if (!chunks.length) {
    return { sources: [], warning: "Aucune source pertinente trouvée. Refuse l'affirmation juridique sur ce point ou demande des précisions." };
  }

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

async function toolDossierContext(args: Record<string, unknown>, ctx: AgentContext) {
  const dossier_id = String(args.dossier_id ?? "");
  if (!dossier_id) return { error: "dossier_id requis" };

  const { data: d } = await ctx.supabase
    .from("dossiers").select("id, title, status, created_at")
    .eq("id", dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!d) return { error: "Dossier introuvable" };

  const [tl, tasks, risks, deadlines] = await Promise.all([
    ctx.supabase.from("case_timeline_events")
      .select("event_type, summary, occurred_at").eq("dossier_id", dossier_id)
      .order("occurred_at", { ascending: false }).limit(15),
    ctx.supabase.from("dossier_tasks")
      .select("title, status, priority, due_date").eq("dossier_id", dossier_id)
      .neq("status", "done").limit(20),
    ctx.supabase.from("identified_risks")
      .select("title, severity, status, legal_basis").eq("dossier_id", dossier_id)
      .neq("status", "resolved").limit(20),
    ctx.supabase.from("dossier_deadlines")
      .select("title, due_date").eq("dossier_id", dossier_id)
      .order("due_date").limit(10),
  ]);

  return {
    dossier: d,
    timeline: tl.data ?? [],
    open_tasks: tasks.data ?? [],
    open_risks: risks.data ?? [],
    deadlines: deadlines.data ?? [],
  };
}

async function toolListDossiers(args: Record<string, unknown>, ctx: AgentContext) {
  const limit = Math.min(Number(args.limit) || 20, 50);
  let q = ctx.supabase
    .from("dossiers")
    .select("id, title, status, domain, created_at")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (typeof args.status === "string") q = q.eq("status", args.status);
  if (typeof args.domain === "string") q = q.eq("domain", args.domain);
  const { data, error } = await q;
  if (error) return { error: error.message };
  return { dossiers: data ?? [] };
}

async function toolProposeDocument(args: Record<string, unknown>, ctx: AgentContext) {
  const dossier_id = String(args.dossier_id ?? "");
  const doc_type = String(args.doc_type ?? "");
  if (!dossier_id || !doc_type) return { error: "dossier_id et doc_type requis" };

  const { data: d } = await ctx.supabase.from("dossiers")
    .select("id").eq("id", dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!d) return { error: "Dossier introuvable" };

  const { data, error } = await (ctx.supabase as any).from("document_generation_sessions")
    .insert({
      tenant_id: ctx.tenantId,
      dossier_id,
      document_type: doc_type,
      domain: typeof args.domain === "string" ? args.domain : null,
      status: "draft",
      params: typeof args.params === "object" ? args.params : {},
      created_by: ctx.userId,
    })
    .select("id, document_type, status").single();
  if (error) return { error: error.message };

  await logEvent(ctx, dossier_id, "document.proposed", `Document proposé : ${doc_type}`, { session_id: data.id });
  return { session: data, next_step: "L'utilisateur doit compléter les paramètres puis valider." };
}

async function toolIdentifyRisk(args: Record<string, unknown>, ctx: AgentContext) {
  const dossier_id = String(args.dossier_id ?? "");
  const title = String(args.title ?? "").slice(0, 200);
  const severity = String(args.severity ?? "medium");
  if (!dossier_id || !title) return { error: "champs requis manquants" };

  const { data: d } = await ctx.supabase.from("dossiers")
    .select("id").eq("id", dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!d) return { error: "Dossier introuvable" };

  const { data, error } = await (ctx.supabase as any).from("identified_risks")
    .insert({
      tenant_id: ctx.tenantId,
      dossier_id,
      title,
      severity,
      legal_basis: typeof args.legal_basis === "string" ? args.legal_basis : null,
      description: typeof args.description === "string" ? args.description : null,
      status: "open",
      identified_by: ctx.userId,
    })
    .select("id, title, severity").single();
  if (error) return { error: error.message };

  await logEvent(ctx, dossier_id, "risk.identified", `Risque identifié (${severity}) : ${title}`, { risk_id: data.id });
  return { risk: data };
}

async function toolRequestValidation(args: Record<string, unknown>, ctx: AgentContext) {
  const dossier_id = String(args.dossier_id ?? "");
  const action_type = String(args.action_type ?? "");
  if (!dossier_id || !action_type) return { error: "champs requis manquants" };

  const { data: d } = await ctx.supabase.from("dossiers")
    .select("id").eq("id", dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!d) return { error: "Dossier introuvable" };

  const { data, error } = await (ctx.supabase as any).from("validation_requests")
    .insert({
      tenant_id: ctx.tenantId,
      dossier_id,
      action_type,
      payload: typeof args.payload === "object" ? args.payload : {},
      reason: typeof args.reason === "string" ? args.reason : null,
      status: "pending",
      requested_by: ctx.userId,
    })
    .select("id, action_type, status").single();
  if (error) return { error: error.message };

  await logEvent(ctx, dossier_id, "validation.requested", `Validation demandée : ${action_type}`, { validation_id: data.id });
  return { validation: data };
}

async function toolScheduleReminder(args: Record<string, unknown>, ctx: AgentContext) {
  const title = String(args.title ?? "").slice(0, 200);
  const remind_at = String(args.remind_at ?? "");
  if (!title || !remind_at) return { error: "champs requis manquants" };

  const dossier_id = typeof args.dossier_id === "string" ? args.dossier_id : null;
  if (dossier_id) {
    const { data: d } = await ctx.supabase.from("dossiers")
      .select("id").eq("id", dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!d) return { error: "Dossier introuvable" };
  }

  const { data, error } = await (ctx.supabase as any).from("reminders")
    .insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      dossier_id,
      title,
      remind_at,
      channel: typeof args.channel === "string" ? args.channel : "in_app",
      status: "pending",
    })
    .select("id, title, remind_at").single();
  if (error) return { error: error.message };

  if (dossier_id) {
    await logEvent(ctx, dossier_id, "reminder.scheduled", `Rappel programmé : ${title}`, { remind_at });
  }
  return { reminder: data };
}

async function toolCreateTask(args: Record<string, unknown>, ctx: AgentContext) {
  const dossier_id = String(args.dossier_id ?? "");
  const title = String(args.title ?? "").slice(0, 200);
  if (!dossier_id || !title) return { error: "dossier_id et title requis" };

  const { data: d } = await ctx.supabase
    .from("dossiers").select("id").eq("id", dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!d) return { error: "Dossier introuvable" };

  const allowed = new Set(["low", "normal", "high", "urgent"]);
  const priority = typeof args.priority === "string" && allowed.has(args.priority)
    ? args.priority : "normal";

  const { data, error } = await (ctx.supabase as any)
    .from("dossier_tasks")
    .insert({
      tenant_id: ctx.tenantId,
      dossier_id,
      title,
      priority,
      due_date: typeof args.due_date === "string" ? args.due_date : null,
      created_by: ctx.userId,
      status: "todo",
    })
    .select("id, title, priority, due_date")
    .single();
  if (error) return { error: error.message };

  await logEvent(ctx, dossier_id, "task.created", `Tâche créée : ${title}`, { task_id: data.id, priority });
  return { task: data };
}

async function toolCreateDeadline(args: Record<string, unknown>, ctx: AgentContext) {
  const dossier_id = String(args.dossier_id ?? "");
  const title = String(args.title ?? "").slice(0, 200);
  const due_date = String(args.due_date ?? "");
  if (!dossier_id || !title || !due_date) return { error: "champs requis manquants" };

  const { data: d } = await ctx.supabase
    .from("dossiers").select("id").eq("id", dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!d) return { error: "Dossier introuvable" };

  const { data, error } = await (ctx.supabase as any)
    .from("dossier_deadlines")
    .insert({ tenant_id: ctx.tenantId, dossier_id, title, due_date, created_by: ctx.userId })
    .select("id, title, due_date")
    .single();
  if (error) return { error: error.message };

  await logEvent(ctx, dossier_id, "deadline.created", `Échéance créée : ${title}`, { due_date });
  return { deadline: data };
}

async function toolLogTimeline(args: Record<string, unknown>, ctx: AgentContext) {
  const dossier_id = String(args.dossier_id ?? "");
  const event_type = String(args.event_type ?? "");
  const summary = String(args.summary ?? "").slice(0, 500);
  if (!dossier_id || !event_type || !summary) return { error: "champs requis manquants" };

  const { data: d } = await ctx.supabase.from("dossiers")
    .select("id").eq("id", dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!d) return { error: "Dossier introuvable" };

  await logEvent(ctx, dossier_id, event_type, summary, typeof args.payload === "object" ? args.payload as Record<string, unknown> : {});
  return { ok: true };
}

async function logEvent(ctx: AgentContext, dossier_id: string, event_type: string, summary: string, payload: Record<string, unknown> = {}) {
  try {
    await (ctx.supabase as any).from("case_timeline_events").insert({
      tenant_id: ctx.tenantId,
      dossier_id,
      actor_id: ctx.userId,
      actor_type: "agent",
      event_type,
      summary,
      payload,
    });
  } catch (e) {
    console.error("timeline log failed:", e);
  }
}
