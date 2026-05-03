// Routage par intent dans le pipeline executeAgentRun.
// Pour chaque intent métier, on déclenche l'action concrète :
//  - analyse_document  → entités déjà extraites + extraction d'échéances → contract_deadlines
//  - redaction_document / lancer_procedure → templates correspondants → génération + final_document_ids
//  - gestion_dossier / recherche_dossier → renvoyer la timeline du dossier dans le draft
// Tout est non-bloquant : si une action secondaire échoue, l'agent renvoie quand même sa réponse.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logTimelineEvent } from "./timeline.server";
import { extractEntities } from "./entity-extraction.server";
import { prefillSession } from "./prefill.server";
import type { PrefillSource, TemplateField } from "@/lib/templates/template-config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

type Run = {
  status: string;
  message: string;
  draft: Record<string, unknown>;
  topic: string | null;
  dossier_id: string | null;
};

type Extras = {
  documentIds: string[];
  timeline?: unknown[];
  deadlines?: unknown[];
  suggestedTemplates?: unknown[];
  risks?: Array<{ id: string; title: string; severity: string }>;
};

const DOC_INTENTS = new Set(["redaction_document", "lancer_procedure"]);
const ANALYSIS_INTENTS = new Set(["analyse_document", "analyse_contrat"]);
const SEARCH_INTENTS = new Set(["recherche_dossier", "gestion_dossier"]);

export async function runIntentActions(opts: {
  intent: string;
  run: Run;
  draft: Record<string, unknown>;
  userId: string;
  tenantId: string;
  runId: string;
}): Promise<Extras> {
  const { intent, run, draft, userId, tenantId, runId } = opts;
  const out: Extras = { documentIds: [] };

  try {
    if (ANALYSIS_INTENTS.has(intent)) {
      // Analyse de document/contrat : extraire échéances + récupérer risques détectés
      const attachmentIds = collectAttachmentIds(draft);
      out.deadlines = await extractAndPersistDeadlines({
        tenantId,
        userId,
        runId,
        dossierId: run.dossier_id,
        analysisIds: attachmentIds,
      });
      // Risques déjà identifiés sur le dossier (alimentés par analysis.functions.ts)
      if (run.dossier_id) {
        const { data: risks } = await db
          .from("identified_risks")
          .select("id, title, severity")
          .eq("tenant_id", tenantId)
          .eq("dossier_id", run.dossier_id)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(10);
        out.risks = (risks ?? []) as Array<{ id: string; title: string; severity: string }>;
      }
    }

    if (DOC_INTENTS.has(intent)) {
      // Génération document : suggérer + générer un brouillon HTML pré-rempli
      const suggested = await suggestTemplates({
        tenantId,
        topic: run.topic ?? run.message,
      });
      out.suggestedTemplates = suggested;
      if (suggested.length > 0) {
        const docId = await generateDraftDocument({
          tenantId,
          userId,
          runId,
          dossierId: run.dossier_id,
          templateId: suggested[0].id as string,
          collected: (draft.form as Record<string, unknown>) ?? {},
          uploadedAnalysisId: collectAttachmentIds(draft)[0] ?? null,
        });
        if (docId) out.documentIds.push(docId);
      }
    }

    if (SEARCH_INTENTS.has(intent) && run.dossier_id) {
      // Recherche/gestion dossier : renvoyer la timeline récente
      const { data: events } = await db
        .from("case_timeline_events")
        .select("id, event_type, title, description, occurred_at, metadata")
        .eq("tenant_id", tenantId)
        .eq("dossier_id", run.dossier_id)
        .order("occurred_at", { ascending: false })
        .limit(20);
      out.timeline = events ?? [];
    }
  } catch (err) {
    console.error("[agent-intent-actions] failed", intent, err);
  }

  return out;
}

function collectAttachmentIds(draft: Record<string, unknown>): string[] {
  const att = (draft.attachments as Array<{ analysis_id?: string }> | undefined) ?? [];
  return att
    .map((a) => a?.analysis_id)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
}

// ---------------------------------------------------------------------------
// Échéances de contrat
// ---------------------------------------------------------------------------

async function extractAndPersistDeadlines(opts: {
  tenantId: string;
  userId: string;
  runId: string;
  dossierId: string | null;
  analysisIds: string[];
}) {
  if (opts.analysisIds.length === 0) return [];

  const { data: analyses } = await db
    .from("document_analyses")
    .select("id, filename, extracted_text, analysis")
    .in("id", opts.analysisIds)
    .eq("tenant_id", opts.tenantId);

  const persisted: Array<{ label: string; due_date: string; category: string | null }> = [];

  for (const doc of (analyses ?? []) as Array<{
    id: string;
    filename: string;
    extracted_text: string | null;
    analysis: Record<string, unknown> | null;
  }>) {
    const text = doc.extracted_text ?? "";
    if (!text) continue;
    const entities = extractEntities(text);
    const dates = entities
      .filter((e) => e.type === "date")
      .map((e) => parseFrenchDate(e.raw))
      .filter((d): d is Date => d != null && d.getTime() > Date.now() - 86_400_000);

    // Inférer le label depuis le contexte (~80 chars autour de la date)
    for (const date of dates.slice(0, 8)) {
      const iso = date.toISOString().slice(0, 10);
      const label = inferLabel(text, iso) ?? `Échéance — ${doc.filename}`;
      const category = inferCategory(label);

      const { data: row } = await db
        .from("contract_deadlines")
        .insert({
          tenant_id: opts.tenantId,
          document_analysis_id: doc.id,
          agent_run_id: opts.runId,
          dossier_id: opts.dossierId,
          label,
          due_date: iso,
          category,
        })
        .select("id, label, due_date, category")
        .single();

      if (row) persisted.push({ label: row.label, due_date: row.due_date, category: row.category });
    }
  }

  if (persisted.length > 0 && opts.dossierId) {
    await logTimelineEvent({
      tenantId: opts.tenantId,
      dossierId: opts.dossierId,
      actorId: opts.userId,
      eventType: "contract.deadlines_extracted",
      title: `${persisted.length} échéance(s) extraite(s)`,
      metadata: { count: persisted.length, run_id: opts.runId },
    });
  }

  return persisted;
}

function parseFrenchDate(raw: string): Date | null {
  const m = raw.match(/(\d{1,2})[\s/.-](\d{1,2})[\s/.-](\d{2,4})/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return isNaN(dt.getTime()) ? null : dt;
}

function inferLabel(text: string, iso: string): string | null {
  // Cherche le contexte autour d'un mot-clé proche de la date dans le texte
  const keywords = /(échéance|expiration|renouvellement|résiliation|paiement|fin|terme|préavis|reconduction)/i;
  const lines = text.split(/[\n.;]/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (keywords.test(line) && line.length < 200) return line.slice(0, 180);
  }
  return null;
}

function inferCategory(label: string): string {
  const l = label.toLowerCase();
  if (/résili|préavis|reconduction|renouvel/.test(l)) return "renouvellement";
  if (/paiement|facture|règlement/.test(l)) return "paiement";
  if (/fin|terme|expir/.test(l)) return "fin_contrat";
  return "autre";
}

// ---------------------------------------------------------------------------
// Génération de document pré-rempli
// ---------------------------------------------------------------------------

async function suggestTemplates(opts: { tenantId: string; topic: string }) {
  const q = opts.topic.toLowerCase();
  const { data } = await db
    .from("document_templates")
    .select("id, name, slug, category, risk_level, body, prefill_sources")
    .or(`is_public.eq.true,tenant_id.eq.${opts.tenantId}`)
    .eq("status", "validated")
    .limit(50);

  const all = (data ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    category: string | null;
  }>;

  // Score lexical simple
  const scored = all
    .map((t) => {
      const hay = `${t.name} ${t.slug} ${t.category ?? ""}`.toLowerCase();
      const tokens = q.split(/\s+/).filter((w) => w.length > 3);
      const hits = tokens.filter((w) => hay.includes(w)).length;
      return { ...t, score: hits };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored;
}

async function generateDraftDocument(opts: {
  tenantId: string;
  userId: string;
  runId: string;
  dossierId: string | null;
  templateId: string;
  collected: Record<string, unknown>;
  uploadedAnalysisId: string | null;
}): Promise<string | null> {
  // Charge le modèle (avec variables/prefill_sources)
  const { data: tpl } = await db
    .from("document_templates")
    .select("id, name, body, archive_to_case, risk_level, variables, prefill_sources")
    .eq("id", opts.templateId)
    .maybeSingle();
  if (!tpl) return null;

  // Prefill avancé : dossier + client + OCR (sans écraser ce que l'user a fourni)
  const fields = (Array.isArray(tpl.variables) ? tpl.variables : []) as TemplateField[];
  const prefillSources = (Array.isArray(tpl.prefill_sources)
    ? tpl.prefill_sources
    : ["dossier", "client", "ocr"]) as PrefillSource[];

  let merged: Record<string, unknown> = { ...opts.collected };
  let uncertain: Array<{ key: string; reason: string }> = [];
  try {
    const pf = await prefillSession(fields, {
      tenantId: opts.tenantId,
      dossierId: opts.dossierId,
      uploadedAnalysisId: opts.uploadedAnalysisId,
      enabledSources: prefillSources,
    });
    // user-provided values win over prefill
    merged = { ...pf.data, ...opts.collected };
    uncertain = pf.uncertain;
  } catch (err) {
    console.warn("[agent-intent-actions] prefill failed", err);
  }

  // Substitution {{key}}
  const body = (tpl.body as string) ?? "";
  const filled = body.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    const v = merged[key];
    return v == null || v === "" ? `[à compléter : ${key}]` : String(v);
  });

  const title = `${tpl.name} — ${new Date().toLocaleDateString("fr-FR")}`;

  const { data: doc, error } = await db
    .from("generated_documents")
    .insert({
      tenant_id: opts.tenantId,
      template_id: tpl.id,
      dossier_id: tpl.archive_to_case === false ? null : opts.dossierId,
      generated_by: opts.userId,
      title,
      content_html: filled,
      output_format: "html",
      variables_used: merged,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !doc) {
    console.error("[agent-intent-actions] generateDraftDocument failed", error);
    return null;
  }

  if (opts.dossierId) {
    await logTimelineEvent({
      tenantId: opts.tenantId,
      dossierId: opts.dossierId,
      actorId: opts.userId,
      eventType: "agent.document_generated",
      title: `Document préparé par l'agent : ${tpl.name}`,
      metadata: {
        document_id: doc.id,
        run_id: opts.runId,
        template_id: tpl.id,
        uncertain_fields: uncertain,
      },
    });
  }

  return doc.id as string;
}
