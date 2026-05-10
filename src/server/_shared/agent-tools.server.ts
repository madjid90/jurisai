// Outils de l'agent JurisAI (côté serveur, server-only).
// Chaque outil retourne un résultat sérialisable + flag is_sensitive
// pour que le pipeline agent puisse (a) tracer dans agent_tool_runs et
// (b) basculer en demande de validation si nécessaire.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logTimelineEvent } from "./timeline.server";
import { llmFetch } from "./llm-fetch.server";
import { resolveChatModel, DEFAULT_EMBED_MODEL } from "./llm-models.server";

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1";
const EMBED_MODEL = DEFAULT_EMBED_MODEL;

export type AgentCtx = {
  userId: string;
  tenantId: string;
  idcc: string | null;
  apiKey: string;
  sources: Array<{ n: number; title: string; ref: string | null; url: string | null }>;
};

export type ToolOutcome = {
  result: unknown;
  isSensitive?: boolean;
  validationRequestId?: string | null;
  succeeded: boolean;
  errorMessage?: string;
};

const SENSITIVE_DOC_TYPES = new Set([
  "lettre_licenciement",
  "rupture_conventionnelle",
  "mise_en_demeure",
  "transaction",
  "depot_legal",
  "conclusions_contentieux",
  "assignation",
]);

/**
 * Parse JSON tolérant : enlève les ```json fences``` et tente d'extraire le
 * premier objet `{...}` si JSON.parse direct échoue. Évite les crashs quand
 * le LLM ajoute du texte autour.
 */
export function safeParseJSON(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try { return JSON.parse(fenced[1].trim()); } catch { /* fall through */ }
    }
    const obj = raw.match(/\{[\s\S]*\}/);
    if (obj) {
      try { return JSON.parse(obj[0]); } catch { /* fall through */ }
    }
    throw new Error(`Réponse LLM non-JSON: ${raw.slice(0, 200)}`);
  }
}

// ------------------------------------------------------------------ classify
export async function classifyIntent(
  message: string,
  ctx: AgentCtx,
): Promise<{
  intent: string;
  domain: string;
  topic: string;
  confidence: number;
  requires_rag: boolean;
  requires_document_upload: boolean;
  requires_form: boolean;
  requires_validation: boolean;
  suggested_actions: Array<{ kind: string; label: string; payload?: Record<string, unknown> }>;
  missing_information: string[];
}> {
  const res = await llmFetch(`${AI_GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: await resolveChatModel(ctx.tenantId),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Tu es un classifieur juridique. Pour une demande, retourne STRICTEMENT un JSON :
{
  "intent": "question_juridique|redaction_document|analyse_document|gestion_dossier|suivi_echeance|conformite|veille|recherche_jurisprudence|chiffrage|reclamation|autre",
  "domain": "rh|commercial|societes|rgpd|fiscal|contentieux|administratif|reglementation_metier|general",
  "topic": "court résumé du sujet (max 80 car)",
  "confidence": 0..1,
  "requires_rag": true|false,
  "requires_document_upload": true|false,
  "requires_form": true|false,
  "requires_validation": true|false,
  "suggested_actions": [{"kind":"search_law|propose_document|identify_risk|create_task|create_deadline|schedule_reminder|request_validation","label":"action humainement compréhensible","payload":{}}],
  "missing_information": ["info manquante 1","..."]
}
Aucun texte hors JSON.`,
        },
        { role: "user", content: message.slice(0, 3000) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Classification IA ${res.status}`);
  const j = await res.json();
  const raw = j.choices?.[0]?.message?.content ?? "{}";
  const parsed = safeParseJSON(raw);
  return {
    intent: String(parsed.intent ?? "autre"),
    domain: String(parsed.domain ?? "general"),
    topic: String(parsed.topic ?? "").slice(0, 200),
    confidence: Number(parsed.confidence ?? 0),
    requires_rag: Boolean(parsed.requires_rag),
    requires_document_upload: Boolean(parsed.requires_document_upload),
    requires_form: Boolean(parsed.requires_form),
    requires_validation: Boolean(parsed.requires_validation),
    suggested_actions: Array.isArray(parsed.suggested_actions) ? parsed.suggested_actions : [],
    missing_information: Array.isArray(parsed.missing_information) ? parsed.missing_information : [],
  };
}

// ------------------------------------------------------------------ search_law
export async function searchLaw(
  query: string,
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  try {
    const embRes = await llmFetch(`${AI_GATEWAY}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: [query] }),
    });
    if (!embRes.ok) return { result: { error: "embedding failed" }, succeeded: false };
    const embJson = await embRes.json();
    const embedding: number[] = embJson.data?.[0]?.embedding ?? [];
    if (!embedding.length) return { result: { error: "no embedding" }, succeeded: false };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: results, error } = await (supabaseAdmin as any).rpc("hybrid_search", {
      query_embedding: embedding,
      query_text: query,
      match_count: 6,
      idcc_filter: ctx.idcc,
    });
    if (error) return { result: { error: error.message }, succeeded: false };
    const chunks = (results ?? []) as Array<{
      chunk_id: string;
      source_title: string;
      reference_code: string | null;
      official_url: string | null;
      content: string;
    }>;
    if (!chunks.length) {
      return {
        result: {
          sources: [],
          warning: "Aucune source pertinente trouvée. Refuse l'affirmation juridique sur ce point.",
        },
        succeeded: true,
      };
    }
    return {
      result: {
        sources: chunks.map((c) => {
          const n = ctx.sources.length + 1;
          ctx.sources.push({
            n,
            title: c.source_title,
            ref: c.reference_code,
            url: c.official_url,
          });
          return {
            n,
            title: c.source_title,
            reference: c.reference_code,
            url: c.official_url,
            excerpt: c.content.slice(0, 700),
          };
        }),
      },
      succeeded: true,
    };
  } catch (e) {
    return { result: { error: (e as Error).message }, succeeded: false };
  }
}

// ------------------------------------------------------------------ dossier_context
export async function dossierContext(dossierId: string, ctx: AgentCtx): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data: d } = await sb
    .from("dossiers")
    .select("id, title, status, category, risk_level, created_at")
    .eq("id", dossierId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!d) return { result: { error: "Dossier introuvable" }, succeeded: false };

  const [tl, tasks, risks, deadlines] = await Promise.all([
    sb.from("case_timeline_events")
      .select("event_type, title, occurred_at")
      .eq("dossier_id", dossierId)
      .order("occurred_at", { ascending: false })
      .limit(15),
    sb.from("dossier_tasks")
      .select("title, status, priority, due_date")
      .eq("dossier_id", dossierId)
      .neq("status", "done")
      .limit(20),
    sb.from("identified_risks")
      .select("title, severity, status")
      .eq("dossier_id", dossierId)
      .neq("status", "resolved")
      .limit(20),
    sb.from("dossier_deadlines")
      .select("title, due_date")
      .eq("dossier_id", dossierId)
      .order("due_date")
      .limit(10),
  ]);

  return {
    result: {
      dossier: d,
      timeline: tl.data ?? [],
      open_tasks: tasks.data ?? [],
      open_risks: risks.data ?? [],
      deadlines: deadlines.data ?? [],
    },
    succeeded: true,
  };
}

// ------------------------------------------------------------------ identify_risk
export async function identifyRisk(
  args: { dossier_id: string; title: string; severity: string; legal_basis?: string; description?: string },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data: d } = await sb
    .from("dossiers")
    .select("id")
    .eq("id", args.dossier_id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!d) return { result: { error: "Dossier introuvable" }, succeeded: false };

  const legal_basis = args.legal_basis ? [{ source: args.legal_basis }] : [];
  const { data, error } = await sb
    .from("identified_risks")
    .insert({
      tenant_id: ctx.tenantId,
      dossier_id: args.dossier_id,
      title: args.title.slice(0, 200),
      severity: args.severity,
      legal_basis,
      description: args.description ?? null,
      status: "open",
      detected_by: ctx.userId,
      category: "general",
    })
    .select("id, title, severity")
    .single();
  if (error) return { result: { error: error.message }, succeeded: false };

  await logTimelineEvent({
    tenantId: ctx.tenantId,
    dossierId: args.dossier_id,
    actorId: ctx.userId,
    eventType: "risk.detected",
    title: `Risque ${args.severity} : ${args.title}`,
    metadata: { source: "agent", risk_id: data.id },
  });
  return { result: { risk: data }, succeeded: true };
}

// ------------------------------------------------------------------ propose_document
export async function proposeDocument(
  args: { dossier_id: string; doc_type: string; domain?: string; params?: Record<string, unknown> },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data: d } = await sb
    .from("dossiers")
    .select("id")
    .eq("id", args.dossier_id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!d) return { result: { error: "Dossier introuvable" }, succeeded: false };

  const isSensitive = SENSITIVE_DOC_TYPES.has(args.doc_type);

  const { data, error } = await sb
    .from("document_generation_sessions")
    .insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      dossier_id: args.dossier_id,
      scenario: "no_upload",
      status: "in_progress",
      current_step: "agent_proposed",
      collected_data: { doc_type: args.doc_type, domain: args.domain ?? null, params: args.params ?? {} },
    })
    .select("id, status")
    .single();
  if (error) return { result: { error: error.message }, succeeded: false };

  let validationRequestId: string | null = null;
  if (isSensitive) {
    const v = await requestValidation(
      {
        dossier_id: args.dossier_id,
        action_type: `document:${args.doc_type}`,
        reason: `Document sensible proposé par l'agent — validation requise avant génération.`,
        payload: { session_id: data.id, doc_type: args.doc_type },
      },
      ctx,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validationRequestId = ((v.result as any)?.validation?.id as string | undefined) ?? null;
  }

  await logTimelineEvent({
    tenantId: ctx.tenantId,
    dossierId: args.dossier_id,
    actorId: ctx.userId,
    eventType: "document.proposed",
    title: `Document proposé : ${args.doc_type}${isSensitive ? " (sensible)" : ""}`,
    metadata: { source: "agent", session_id: data.id, sensitive: isSensitive },
  });

  return {
    result: { session: data, doc_type: args.doc_type, sensitive: isSensitive, validation_request_id: validationRequestId },
    isSensitive,
    validationRequestId,
    succeeded: true,
  };
}

// ------------------------------------------------------------------ request_validation
export async function requestValidation(
  args: { dossier_id: string; action_type: string; reason?: string; payload?: Record<string, unknown> },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data: d } = await sb
    .from("dossiers")
    .select("id")
    .eq("id", args.dossier_id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!d) return { result: { error: "Dossier introuvable" }, succeeded: false };

  const { data: admins } = await sb
    .from("user_roles")
    .select("user_id")
    .eq("tenant_id", ctx.tenantId)
    .in("role", ["admin", "admin_tenant", "super_admin"])
    .neq("user_id", ctx.userId) // ne jamais s'assigner à soi-même (auto-validation)
    .limit(1);
  const assigned_to = (admins?.[0] as { user_id: string } | undefined)?.user_id;
  if (!assigned_to) {
    return {
      result: {
        error:
          "Validation impossible : aucun admin disponible dans ce tenant pour valider une action sensible. Contactez votre administrateur.",
      },
      succeeded: false,
    };
  }

  const { data, error } = await sb
    .from("validation_requests")
    .insert({
      tenant_id: ctx.tenantId,
      dossier_id: args.dossier_id,
      requested_by: ctx.userId,
      assigned_to,
      subject_type: args.action_type,
      comment: args.reason ?? null,
      status: "pending",
    })
    .select("id, subject_type, status")
    .single();
  if (error) return { result: { error: error.message }, succeeded: false };

  await logTimelineEvent({
    tenantId: ctx.tenantId,
    dossierId: args.dossier_id,
    actorId: ctx.userId,
    eventType: "validation.requested",
    title: `Validation demandée : ${args.action_type}`,
    metadata: { source: "agent", validation_id: data.id },
  });
  return { result: { validation: data }, isSensitive: true, validationRequestId: data.id, succeeded: true };
}

// ------------------------------------------------------------------ schedule_reminder
export async function scheduleReminder(
  args: { dossier_id?: string; title: string; remind_at: string; channel?: string },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  if (args.dossier_id) {
    const { data: d } = await sb
      .from("dossiers")
      .select("id")
      .eq("id", args.dossier_id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (!d) return { result: { error: "Dossier introuvable" }, succeeded: false };
  }
  const { data, error } = await sb
    .from("reminders")
    .insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      created_by: ctx.userId,
      dossier_id: args.dossier_id ?? null,
      title: args.title.slice(0, 200),
      remind_at: args.remind_at,
      metadata: { channel: args.channel ?? "in_app", source: "agent" },
    })
    .select("id, title, remind_at")
    .single();
  if (error) return { result: { error: error.message }, succeeded: false };
  if (args.dossier_id) {
    await logTimelineEvent({
      tenantId: ctx.tenantId,
      dossierId: args.dossier_id,
      actorId: ctx.userId,
      eventType: "reminder.created",
      title: `Rappel : ${args.title}`,
      metadata: { source: "agent" },
    });
  }
  return { result: { reminder: data }, succeeded: true };
}

// ------------------------------------------------------------------ create_task
export async function createTask(
  args: { dossier_id: string; title: string; priority?: string; due_date?: string },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data: d } = await sb
    .from("dossiers")
    .select("id")
    .eq("id", args.dossier_id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!d) return { result: { error: "Dossier introuvable" }, succeeded: false };

  const allowed = new Set(["low", "normal", "high", "urgent"]);
  const priority = args.priority && allowed.has(args.priority) ? args.priority : "normal";

  const { data, error } = await sb
    .from("dossier_tasks")
    .insert({
      tenant_id: ctx.tenantId,
      dossier_id: args.dossier_id,
      title: args.title.slice(0, 200),
      priority,
      due_date: args.due_date ?? null,
      created_by: ctx.userId,
      status: "todo",
    })
    .select("id, title, priority, due_date")
    .single();
  if (error) return { result: { error: error.message }, succeeded: false };

  await logTimelineEvent({
    tenantId: ctx.tenantId,
    dossierId: args.dossier_id,
    actorId: ctx.userId,
    eventType: "task.created",
    title: `Tâche : ${args.title}`,
    metadata: { source: "agent" },
  });
  return { result: { task: data }, succeeded: true };
}

// ------------------------------------------------------------------ create_deadline
export async function createDeadline(
  args: { dossier_id: string; title: string; due_date: string },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data: d } = await sb
    .from("dossiers")
    .select("id")
    .eq("id", args.dossier_id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!d) return { result: { error: "Dossier introuvable" }, succeeded: false };

  const { data, error } = await sb
    .from("dossier_deadlines")
    .insert({
      tenant_id: ctx.tenantId,
      dossier_id: args.dossier_id,
      title: args.title.slice(0, 200),
      due_date: args.due_date,
      created_by: ctx.userId,
    })
    .select("id, title, due_date")
    .single();
  if (error) return { result: { error: error.message }, succeeded: false };

  await logTimelineEvent({
    tenantId: ctx.tenantId,
    dossierId: args.dossier_id,
    actorId: ctx.userId,
    eventType: "deadline.created",
    title: `Échéance : ${args.title}`,
    metadata: { source: "agent" },
  });
  return { result: { deadline: data }, succeeded: true };
}

// ------------------------------------------------------------------ search_dossier
export async function searchDossier(
  args: { query: string; limit?: number },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const limit = Math.min(Math.max(args.limit ?? 8, 1), 20);
  const q = (args.query ?? "").trim();
  if (!q) return { result: { dossiers: [] }, succeeded: true };

  // Recherche simple ILIKE sur title/description, scoped tenant.
  const { data, error } = await sb
    .from("dossiers")
    .select("id, title, status, category, risk_level, created_at")
    .eq("tenant_id", ctx.tenantId)
    .or(`title.ilike.%${q.replace(/[%,]/g, "")}%,description.ilike.%${q.replace(/[%,]/g, "")}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { result: { error: error.message }, succeeded: false };
  return { result: { dossiers: data ?? [] }, succeeded: true };
}

// ------------------------------------------------------------------ create_dossier
export async function createDossierTool(
  args: {
    title: string;
    category?: string;
    description?: string;
    client_id?: string;
    risk_level?: string;
  },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const allowedRisk = new Set(["low", "medium", "high", "critical"]);
  const risk_level = args.risk_level && allowedRisk.has(args.risk_level) ? args.risk_level : "low";

  const { data, error } = await sb
    .from("dossiers")
    .insert({
      tenant_id: ctx.tenantId,
      created_by: ctx.userId,
      title: args.title.slice(0, 200),
      description: args.description ?? null,
      category: args.category ?? "general",
      status: "open",
      risk_level,
      client_id: args.client_id ?? null,
    })
    .select("id, title, category, status, risk_level")
    .single();
  if (error) return { result: { error: error.message }, succeeded: false };

  await logTimelineEvent({
    tenantId: ctx.tenantId,
    dossierId: data.id,
    actorId: ctx.userId,
    eventType: "dossier.created",
    title: `Dossier créé : ${data.title}`,
    metadata: { source: "agent", category: data.category },
  });
  return { result: { dossier: data }, succeeded: true };
}

// ------------------------------------------------------------------ start_workflow
export async function startWorkflowTool(
  args: {
    definition_id?: string;
    definition_slug?: string;
    title?: string;
    dossier_id?: string;
    client_id?: string;
    context?: Record<string, unknown>;
  },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;

  // Résoudre la définition
  let defRow: { id: string; title: string; tenant_id: string | null } | null = null;
  if (args.definition_id) {
    const { data } = await sb
      .from("workflow_definitions")
      .select("id, title, tenant_id")
      .eq("id", args.definition_id)
      .maybeSingle();
    defRow = data ?? null;
  } else if (args.definition_slug) {
    const { data } = await sb
      .from("workflow_definitions")
      .select("id, title, tenant_id")
      .eq("slug", args.definition_slug)
      .or(`tenant_id.is.null,tenant_id.eq.${ctx.tenantId}`)
      .maybeSingle();
    defRow = data ?? null;
  }
  if (!defRow) return { result: { error: "Définition de workflow introuvable" }, succeeded: false };
  if (defRow.tenant_id && defRow.tenant_id !== ctx.tenantId) {
    return { result: { error: "Workflow non accessible" }, succeeded: false };
  }

  // Vérifier dossier si fourni
  if (args.dossier_id) {
    const { data: d } = await sb
      .from("dossiers")
      .select("id")
      .eq("id", args.dossier_id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (!d) return { result: { error: "Dossier introuvable" }, succeeded: false };
  }

  const { data: inst, error } = await sb
    .from("workflow_instances")
    .insert({
      tenant_id: ctx.tenantId,
      definition_id: defRow.id,
      title: (args.title ?? defRow.title).slice(0, 200),
      dossier_id: args.dossier_id ?? null,
      client_id: args.client_id ?? null,
      started_by: ctx.userId,
      context: args.context ?? {},
    })
    .select("id, title, status")
    .single();
  if (error) return { result: { error: error.message }, succeeded: false };

  if (args.dossier_id) {
    await logTimelineEvent({
      tenantId: ctx.tenantId,
      dossierId: args.dossier_id,
      actorId: ctx.userId,
      eventType: "workflow.started",
      title: `Procédure démarrée : ${inst.title}`,
      metadata: { source: "agent", instance_id: inst.id, definition_id: defRow.id },
    });
  }
  return { result: { instance: inst }, succeeded: true };
}

// ------------------------------------------------------------------ analyze_document
export async function analyzeDocumentTool(
  args: { document_id: string; dossier_id?: string },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data: doc } = await sb
    .from("documents")
    .select("id, title, content")
    .eq("id", args.document_id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!doc) return { result: { error: "Document introuvable" }, succeeded: false };

  const text = String(doc.content ?? "").slice(0, 12000);
  if (!text.trim()) return { result: { error: "Document vide" }, succeeded: false };

  // LLM : extraction de risques + résumé court
  const res = await llmFetch(`${AI_GATEWAY}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: await resolveChatModel(ctx.tenantId),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Analyse juridique d'un document. Retourne STRICTEMENT un JSON :
{
  "summary": "résumé en 3 phrases max",
  "doc_type_guess": "type probable (contrat, lettre, conclusions, etc.)",
  "risks": [{"title":"...","severity":"low|medium|high|critical","rationale":"..."}],
  "missing_clauses": ["..."],
  "key_points": ["..."]
}`,
        },
        { role: "user", content: `Titre : ${doc.title}\n\nContenu :\n${text}` },
      ],
    }),
  });
  if (!res.ok) return { result: { error: `IA ${res.status}` }, succeeded: false };
  const j = await res.json();
  let parsed: any = {};
  try { parsed = safeParseJSON(j.choices?.[0]?.message?.content ?? "{}"); } catch { /* noop */ }

  // Si dossier fourni, persister les risques détectés
  let riskCount = 0;
  if (args.dossier_id && Array.isArray(parsed.risks)) {
    const { data: dCheck } = await sb
      .from("dossiers").select("id").eq("id", args.dossier_id).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (dCheck) {
      // R32: insertion parallèle (Promise.all) au lieu de séquentiel
      const riskRows = parsed.risks.slice(0, 10).map((r: any) => ({
        tenant_id: ctx.tenantId,
        dossier_id: args.dossier_id,
        title: String(r.title ?? "Risque").slice(0, 200),
        severity: ["low","medium","high","critical"].includes(r.severity) ? r.severity : "medium",
        description: String(r.rationale ?? "").slice(0, 1000),
        legal_basis: [],
        status: "open",
        detected_by: ctx.userId,
        category: "document_analysis",
      }));
      if (riskRows.length) {
        const { error: insErr } = await sb.from("identified_risks").insert(riskRows);
        if (!insErr) riskCount = riskRows.length;
      }
      await logTimelineEvent({
        tenantId: ctx.tenantId,
        dossierId: args.dossier_id,
        actorId: ctx.userId,
        eventType: "analysis.completed",
        title: `Analyse document : ${doc.title}`,
        description: parsed.summary ?? null,
        metadata: { source: "agent", document_id: doc.id, risks_count: riskCount },
      });
    }
  }

  return {
    result: {
      document_id: doc.id,
      title: doc.title,
      summary: parsed.summary ?? "",
      doc_type_guess: parsed.doc_type_guess ?? null,
      risks: parsed.risks ?? [],
      missing_clauses: parsed.missing_clauses ?? [],
      key_points: parsed.key_points ?? [],
      risks_persisted: riskCount,
    },
    succeeded: true,
  };
}

// ------------------------------------------------------------------ generate_workflow
export async function generateWorkflowTool(
  args: { prompt: string; category?: string },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  try {
    const { runGenerateWorkflow } = await import("@/server/workflow-generator-core.server");
    // Appel direct au helper interne : ctx.userId provient déjà de
    // requireSupabaseAuth (couche agent), donc l'auth n'est pas contournée.
    const res = await runGenerateWorkflow(
      { prompt: args.prompt, category: args.category },
      ctx.userId,
    );
    const isSensitive = Boolean(res?.quality?.sensitive?.contains_sensitive);
    return {
      result: {
        run_id: res?.run_id,
        cache_hit: res?.cache_hit,
        workflow_definition_id: res?.workflow_definition_id,
        auto_status: res?.quality?.auto_status ?? null,
        scores: res?.quality?.scores ?? null,
        sensitive_actions: res?.quality?.sensitive?.detected ?? [],
        duplicate_of: res?.duplicate_of ?? null,
        error: res?.error ?? null,
      },
      isSensitive,
      succeeded: !res?.error,
      errorMessage: res?.error,
    };
  } catch (e) {
    return { result: { error: (e as Error).message }, succeeded: false };
  }
}

// ------------------------------------------------------------------ generate_report
export async function generateReportTool(
  args: { dossier_id: string; report_type?: string },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const { data: d } = await sb
    .from("dossiers")
    .select("id, title, status, category, risk_level, description, created_at")
    .eq("id", args.dossier_id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!d) return { result: { error: "Dossier introuvable" }, succeeded: false };

  const [tl, tasks, risks, deadlines] = await Promise.all([
    sb.from("case_timeline_events")
      .select("event_type, title, description, occurred_at")
      .eq("dossier_id", args.dossier_id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    sb.from("dossier_tasks")
      .select("title, status, priority, due_date")
      .eq("dossier_id", args.dossier_id),
    sb.from("identified_risks")
      .select("title, severity, status, description")
      .eq("dossier_id", args.dossier_id),
    sb.from("dossier_deadlines")
      .select("title, due_date, status")
      .eq("dossier_id", args.dossier_id)
      .order("due_date"),
  ]);

  const reportType = args.report_type ?? "synthese";

  const lines: string[] = [];
  lines.push(`# ${reportType === "synthese" ? "Synthèse" : "Rapport"} — ${d.title}`);
  lines.push("");
  lines.push(`**Catégorie :** ${d.category} · **Statut :** ${d.status} · **Niveau de risque :** ${d.risk_level}`);
  lines.push(`**Ouvert le :** ${new Date(d.created_at).toLocaleDateString("fr-FR")}`);
  if (d.description) { lines.push(""); lines.push(d.description); }

  lines.push("");
  lines.push("## Risques identifiés");
  if (!risks.data?.length) lines.push("_Aucun risque enregistré._");
  for (const r of risks.data ?? []) {
    lines.push(`- **[${r.severity}]** ${r.title} — _${r.status}_${r.description ? `\n  ${r.description}` : ""}`);
  }

  lines.push("");
  lines.push("## Tâches");
  if (!tasks.data?.length) lines.push("_Aucune tâche._");
  for (const t of tasks.data ?? []) {
    lines.push(`- [${t.status}] ${t.title} (priorité ${t.priority}${t.due_date ? `, échéance ${t.due_date}` : ""})`);
  }

  lines.push("");
  lines.push("## Échéances");
  if (!deadlines.data?.length) lines.push("_Aucune échéance._");
  for (const dl of deadlines.data ?? []) {
    lines.push(`- ${dl.due_date} — ${dl.title} (${dl.status ?? "à venir"})`);
  }

  lines.push("");
  lines.push("## Chronologie récente");
  for (const e of tl.data ?? []) {
    lines.push(`- ${new Date(e.occurred_at).toLocaleString("fr-FR")} — **${e.event_type}** : ${e.title}`);
  }

  const markdown = lines.join("\n");

  await logTimelineEvent({
    tenantId: ctx.tenantId,
    dossierId: args.dossier_id,
    actorId: ctx.userId,
    eventType: "report.generated",
    title: `Rapport généré (${reportType})`,
    metadata: { source: "agent", report_type: reportType, length: markdown.length },
  });

  return {
    result: {
      dossier_id: args.dossier_id,
      report_type: reportType,
      markdown,
      stats: {
        risks: risks.data?.length ?? 0,
        tasks: tasks.data?.length ?? 0,
        deadlines: deadlines.data?.length ?? 0,
        timeline_events: tl.data?.length ?? 0,
      },
    },
    succeeded: true,
  };
}

// ------------------------------------------------------------------ run_workflow_step
// Exécute l'étape courante d'un workflow déjà instancié.
// - si l'étape est sensible : crée une demande de validation et bloque
// - sinon : marque l'étape comme done, calcule due_at via legal-delays, avance l'instance
export async function runWorkflowStepTool(
  args: { instance_id: string; step_index: number; notes?: string },
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  try {
    const { executeStep } = await import("./workflow-runtime.server");
    const res = await executeStep(
      {
        instanceId: args.instance_id,
        stepIndex: args.step_index,
        notes: args.notes,
      },
      { userId: ctx.userId, tenantId: ctx.tenantId },
    );
    return {
      result: {
        instance_id: args.instance_id,
        step_index: res.step_run.step_index,
        status: res.step_run.status,
        due_at: res.step_run.due_at,
        delay: res.delay,
        blocked_for_validation: res.blocked_for_validation,
        validation_request_id: res.validation_request_id,
        workflow_completed: res.workflow_completed,
        next_step: res.next_step,
      },
      isSensitive: res.blocked_for_validation,
      validationRequestId: res.validation_request_id,
      succeeded: true,
    };
  } catch (e) {
    return {
      result: { error: (e as Error).message },
      succeeded: false,
      errorMessage: (e as Error).message,
    };
  }
}
