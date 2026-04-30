// Outils de l'agent JurisAI (côté serveur, server-only).
// Chaque outil retourne un résultat sérialisable + flag is_sensitive
// pour que le pipeline agent puisse (a) tracer dans agent_tool_runs et
// (b) basculer en demande de validation si nécessaire.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logTimelineEvent } from "./timeline.server";

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1";
const CHAT_MODEL = "google/gemini-3-flash-preview";
const EMBED_MODEL = "openai/text-embedding-3-small";

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
  const res = await fetch(`${AI_GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
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
  const parsed = JSON.parse(raw);
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
    const embRes = await fetch(`${AI_GATEWAY}/embeddings`, {
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
    .limit(1);
  const assigned_to = (admins?.[0] as { user_id: string } | undefined)?.user_id ?? ctx.userId;

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
