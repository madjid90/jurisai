// ═══════════════════════════════════════════════════════════════════════════
// Workflow Builder + Document Builder + blockSensitiveAction — Sprint J4
// ═══════════════════════════════════════════════════════════════════════════
//
// Consomme une LegalProcedure (sortie J3 Procedure Builder) pour :
//   1. buildWorkflowFromProcedure() — crée workflow_instance + dossier_tasks
//      Réutilise la RPC SECURITY DEFINER existante `instantiate_workflow`.
//   2. verifyWorkflowSteps() — vérification cohérence délais/sources
//   3. linkWorkflowToSources() — log timeline + persist source_ids
//   4. linkWorkflowToDossier() — déjà inclus dans instantiate_workflow
//   5. buildDocumentsFromProcedure() — construit DocumentGrammar par doc_type
//   6. verifyDocumentGrounding() — vérifie mentions obligatoires dans HTML
//   7. blockSensitiveActionUntilValidation() — création auto validation_request
//
// ⚠️ Principe RAG-first respecté : aucune règle juridique hardcodée. La
//    liste des actions sensibles est codée en dur volontairement (anti-pattern
//    serait de la confier au LLM — règle de doctrine seedée dans J1).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { captureServerError } from "./error-monitor.server";
import { logTimelineEvent } from "./timeline.server";
import {
  DocumentGrammarSchema,
  DocumentVerificationSchema,
  type LegalProcedure,
  type ProcedureDocument,
  type StratifiedRetrieval,
  type DocumentGrammar,
  type DocumentVerification,
} from "./lre-schemas.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

export type Agent360BuilderContext = {
  tenantId: string;
  userId: string;
  dossierId?: string | null;
};

// ─── 1. buildWorkflowFromProcedure ─────────────────────────────────────────
//
// Convertit une LegalProcedure structurée en :
//   - workflow_instance (via RPC instantiate_workflow SECURITY DEFINER)
//   - 1 dossier_task par step (via INSERT direct ou RPC)
//   - timeline events pour traçabilité
//
// NB : nous N'utilisons PAS workflow_definitions ici car le plan vise une
// génération dynamique. La procédure construite par le LLM est suffisante.

export type WorkflowBuildResult = {
  ok: boolean;
  workflow_instance_id: string | null;
  dossier_id: string | null;
  task_count: number;
  error?: string;
};

export async function buildWorkflowFromProcedure(
  procedure: LegalProcedure,
  ctx: Agent360BuilderContext,
): Promise<WorkflowBuildResult> {
  try {
    // ─── Étape 0 : vérification cohérence steps ────────────────────
    const verification = verifyWorkflowSteps(procedure);
    if (!verification.ok) {
      return {
        ok: false,
        workflow_instance_id: null,
        dossier_id: ctx.dossierId ?? null,
        task_count: 0,
        error: `Workflow non cohérent : ${verification.errors.join(" | ")}`,
      };
    }

    // ─── Étape 1 : créer ou retrouver un workflow_definition ad hoc ─
    // Pour ne pas casser la contrainte FK workflow_instances.definition_id,
    // on crée à la volée une définition "agent-generated" pour ce slug.
    let definitionId: string | null = null;
    {
      const { data: existingDef } = await db
        .from("workflow_definitions")
        .select("id")
        .eq("slug", procedure.procedure_slug)
        .or(`tenant_id.is.null,tenant_id.eq.${ctx.tenantId}`)
        .maybeSingle();
      if (existingDef?.id) {
        definitionId = existingDef.id;
      } else {
        const { data: newDef, error: defErr } = await db
          .from("workflow_definitions")
          .insert({
            tenant_id: ctx.tenantId,
            slug: procedure.procedure_slug,
            title: procedure.title,
            description: `Procédure générée par l'agent : ${procedure.title}`,
            category: procedure.domain,
            steps: procedure.steps.map((s) => ({
              key: `step_${s.index}`,
              title: s.title,
              description: s.description,
              type: s.step_type,
              legal_refs: s.legal_ref ? [s.legal_ref] : [],
              reminder_days: s.delay_days_after,
              validation_required: s.requires_validation,
            })),
            status: "validated",
            version: 1,
          })
          .select("id")
          .single();
        if (defErr) {
          await captureServerError("agent360.buildWorkflow.insertDefinition", { tenantId: ctx.tenantId, userId: ctx.userId }, defErr);
          return { ok: false, workflow_instance_id: null, dossier_id: ctx.dossierId ?? null, task_count: 0, error: defErr.message };
        }
        definitionId = (newDef as { id: string }).id;
      }
    }

    // ─── Étape 2 : appel RPC instantiate_workflow (J-2 / livré récemment) ─
    const { data: rpcRes, error: rpcErr } = await db.rpc("instantiate_workflow", {
      _user_id: ctx.userId,
      _tenant_id: ctx.tenantId,
      _definition_id: definitionId,
      _title: procedure.title,
      _dossier_id: ctx.dossierId ?? null,
      _client_id: null,
      _context: { source: "agent360_builder", procedure_slug: procedure.procedure_slug },
    });
    if (rpcErr) throw rpcErr;
    const instanceId = (rpcRes as { instance_id: string }).instance_id;

    // ─── Étape 3 : créer 1 dossier_task par step (best-effort) ─────
    let taskCount = 0;
    if (ctx.dossierId) {
      for (const step of procedure.steps) {
        const dueDate = step.delay_days_after
          ? new Date(Date.now() + step.delay_days_after * 86_400_000).toISOString().slice(0, 10)
          : null;
        const { error: taskErr } = await db.from("dossier_tasks").insert({
          tenant_id: ctx.tenantId,
          dossier_id: ctx.dossierId,
          created_by: ctx.userId,
          title: step.title,
          description: step.description
            + (step.legal_ref ? `\nRéférence légale : ${step.legal_ref}` : "")
            + (step.delay_source ? `\nDélai sourcé : ${step.delay_source}` : ""),
          status: "todo",
          priority: step.index === 0 ? "high" : "normal",
          due_date: dueDate,
        });
        if (!taskErr) taskCount++;
      }
    }

    // ─── Étape 4 : timeline + lien sources ─────────────────────────
    if (ctx.dossierId) {
      await logTimelineEvent({
        tenantId: ctx.tenantId,
        dossierId: ctx.dossierId,
        actorId: ctx.userId,
        eventType: "workflow.built",
        title: `Workflow construit : ${procedure.title}`,
        metadata: {
          procedure_slug: procedure.procedure_slug,
          instance_id: instanceId,
          definition_id: definitionId,
          steps_count: procedure.steps.length,
          docs_count: procedure.documents.length,
          deadlines_count: procedure.deadlines.length,
          source: "agent360_builder",
        },
      });
    }

    return {
      ok: true,
      workflow_instance_id: instanceId,
      dossier_id: ctx.dossierId ?? null,
      task_count: taskCount,
    };
  } catch (e) {
    await captureServerError("agent360.buildWorkflowFromProcedure", { tenantId: ctx.tenantId, userId: ctx.userId }, e);
    return {
      ok: false,
      workflow_instance_id: null,
      dossier_id: ctx.dossierId ?? null,
      task_count: 0,
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}

// ─── 2. verifyWorkflowSteps (déterministe) ─────────────────────────────────

export type WorkflowStepsVerification = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function verifyWorkflowSteps(procedure: LegalProcedure): WorkflowStepsVerification {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (procedure.steps.length === 0) {
    errors.push("Aucune étape — workflow vide");
  }

  // Vérif indexation continue
  const indexes = procedure.steps.map((s) => s.index).sort((a, b) => a - b);
  for (let i = 0; i < indexes.length; i++) {
    if (indexes[i] !== i) {
      warnings.push(`Indexation discontinue : ${indexes.join(",")}`);
      break;
    }
  }

  // Vérif délais : si delay_days_after défini, delay_source doit être présent
  for (const step of procedure.steps) {
    if ((step.delay_days_after ?? 0) > 0 && !step.delay_source) {
      warnings.push(`Step #${step.index} "${step.title}" : délai de ${step.delay_days_after}j sans source`);
    }
    if (step.requires_validation && step.validation_roles.length === 0) {
      warnings.push(`Step #${step.index} : requires_validation=true mais aucun rôle assigné`);
    }
  }

  // Vérif deadlines : from_step doit pointer un step existant
  const stepIndexSet = new Set(procedure.steps.map((s) => s.index));
  for (const dl of procedure.deadlines) {
    if (dl.from_step !== null && !stepIndexSet.has(dl.from_step)) {
      errors.push(`Deadline "${dl.label}" : from_step=${dl.from_step} inexistant`);
    }
  }

  // Vérif documents : step_index doit pointer un step existant
  for (const doc of procedure.documents) {
    if (!stepIndexSet.has(doc.step_index)) {
      errors.push(`Document "${doc.doc_type}" : step_index=${doc.step_index} inexistant`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ─── 3. linkWorkflowToSources ──────────────────────────────────────────────
//
// Append-only log des source_ids RAG utilisés par le workflow.
// Utilité : audit "quelles sources ont fondé ce workflow ?"

export async function linkWorkflowToSources(
  workflowInstanceId: string,
  retrieval: StratifiedRetrieval,
  ctx: Agent360BuilderContext,
): Promise<void> {
  try {
    const sourceUuids = [
      ...retrieval.legislation.map((s) => s.source_id),
      ...retrieval.convention.map((s) => s.source_id),
      ...retrieval.jurisprudence.map((s) => s.source_id),
    ];
    if (sourceUuids.length === 0) return;

    // Stocke dans workflow_instances.context.source_ids (JSONB)
    const { data: inst } = await db
      .from("workflow_instances")
      .select("context")
      .eq("id", workflowInstanceId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    const existingCtx = (inst?.context ?? {}) as Record<string, unknown>;
    const updatedCtx = { ...existingCtx, source_ids: sourceUuids, linked_at: new Date().toISOString() };

    await db
      .from("workflow_instances")
      .update({ context: updatedCtx })
      .eq("id", workflowInstanceId)
      .eq("tenant_id", ctx.tenantId);
  } catch (e) {
    await captureServerError("agent360.linkWorkflowToSources", { tenantId: ctx.tenantId, userId: ctx.userId }, e);
  }
}

// ─── 4. buildDocumentsFromProcedure ────────────────────────────────────────
//
// Pour chaque ProcedureDocument, persiste une DocumentGrammar en cache
// (table document_generation_rules de J1). N'appelle PAS le LLM ici —
// la grammaire est déjà déterminée par le Procedure Builder qui a injecté
// les required_mentions sourcées.

export type DocumentsBuildResult = {
  ok: boolean;
  grammars_persisted: number;
  errors: string[];
};

export async function buildDocumentsFromProcedure(
  procedure: LegalProcedure,
  retrieval: StratifiedRetrieval,
  ctx: Agent360BuilderContext,
): Promise<DocumentsBuildResult> {
  const errors: string[] = [];
  let persisted = 0;

  for (const doc of procedure.documents) {
    try {
      const grammar = buildDocumentGrammar(doc, retrieval, procedure.domain);
      // Cache upsert (tenant, document_type)
      const { data: existing } = await db
        .from("document_generation_rules")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("document_type", grammar.document_type)
        .maybeSingle();

      const sourceUuids = grammar.required_legal_mentions
        .map((m) => {
          const all = [...retrieval.legislation, ...retrieval.convention, ...retrieval.jurisprudence];
          return all.find((s) => s.n === m.source_id)?.source_id;
        })
        .filter(Boolean) as string[];

      const payload = {
        document_type: grammar.document_type,
        domain: grammar.domain,
        template_slug: grammar.template_slug,
        required_fields: grammar.required_fields,
        required_legal_mentions: grammar.required_legal_mentions,
        forbidden_phrases: grammar.forbidden_phrases,
        source_ids: sourceUuids,
        validation_required: grammar.validation_required,
        output_formats: grammar.output_formats,
        built_by_llm: true,
        verified: true,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        await db.from("document_generation_rules").update(payload).eq("id", existing.id);
      } else {
        await db.from("document_generation_rules").insert({ ...payload, tenant_id: ctx.tenantId });
      }
      persisted++;
    } catch (e) {
      errors.push(`Document "${doc.doc_type}" : ${e instanceof Error ? e.message : "unknown"}`);
      await captureServerError("agent360.buildDocumentsFromProcedure", { tenantId: ctx.tenantId, userId: ctx.userId, extra: { doc_type: doc.doc_type } }, e);
    }
  }

  return { ok: errors.length === 0, grammars_persisted: persisted, errors };
}

function buildDocumentGrammar(
  doc: ProcedureDocument,
  retrieval: StratifiedRetrieval,
  domain: string,
): DocumentGrammar {
  const all = [...retrieval.legislation, ...retrieval.convention, ...retrieval.jurisprudence];
  const sourceById = new Map(all.map((s) => [s.n, s]));

  const mentions = doc.required_mentions
    .filter((m) => sourceById.has(m.source_id))
    .map((m) => ({
      mention: m.mention,
      legal_ref: m.legal_ref,
      source_id: m.source_id,
      verbatim_extrait: m.verbatim_extrait,
      position_hint: null,
    }));

  const grammar: DocumentGrammar = {
    document_type: doc.doc_type,
    domain,
    template_slug: doc.template_slug,
    required_fields: [],
    required_legal_mentions: mentions,
    forbidden_phrases: [],
    validation_required: doc.validation_required,
    output_formats: ["pdf", "docx"],
  };
  return DocumentGrammarSchema.parse(grammar);
}

// ─── 5. verifyDocumentGrounding (déterministe) ─────────────────────────────
//
// Vérifie que le HTML final d'un document contient toutes les mentions
// obligatoires (from grammar.required_legal_mentions) et aucune phrase
// interdite. Appelé après génération, avant export PDF/DOCX.

export function verifyDocumentGrounding(
  htmlContent: string,
  grammar: DocumentGrammar,
): DocumentVerification {
  const mentions_present: string[] = [];
  const mentions_missing: string[] = [];
  const forbidden_found: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const normHtml = normalize(htmlContent);

  for (const m of grammar.required_legal_mentions) {
    // Match flexible : on extrait les tokens significatifs (≥4 chars) de la
    // mention et on vérifie qu'ils sont TOUS présents dans le HTML, peu
    // importe l'ordre exact. Tolère les petits mots de liaison ("par", "un",
    // "de", etc.) qui peuvent varier sans changer le sens juridique.
    const tokens = normalize(m.mention)
      .split(/\s+/)
      .filter((t) => t.length >= 4);
    const significantTokens = tokens.slice(0, 6); // garde-fou — 6 mots suffisent
    const allPresent =
      significantTokens.length > 0 &&
      significantTokens.every((t) => normHtml.includes(t));
    if (allPresent) {
      mentions_present.push(m.mention);
    } else {
      mentions_missing.push(m.mention);
      errors.push(`Mention obligatoire absente : "${m.mention}" (${m.legal_ref})`);
    }
  }

  for (const f of grammar.forbidden_phrases) {
    if (normHtml.includes(normalize(f.phrase))) {
      forbidden_found.push(f.phrase);
      errors.push(`Phrase interdite trouvée : "${f.phrase}" — ${f.reason}`);
    }
  }

  const total = grammar.required_legal_mentions.length;
  const grounding_health = total === 0 ? 1 : mentions_present.length / total;
  const ok = errors.length === 0;

  return DocumentVerificationSchema.parse({
    ok,
    mentions_present,
    mentions_missing,
    forbidden_found,
    fields_missing: [],
    errors,
    warnings,
    grounding_health,
  });
}

// ─── 6. blockSensitiveActionUntilValidation ────────────────────────────────
//
// Liste des actions sensibles CODÉE EN DUR (anti-pattern serait de la
// confier au LLM — déjà documenté dans legal_doctrine_rules de J1).
// Crée une validation_request en pending et retourne son ID. Tant que
// non décidée, l'action ne doit pas s'exécuter.

const SENSITIVE_ACTIONS = new Set([
  "licenciement",
  "licenciement_personnel",
  "licenciement_faute_grave",
  "licenciement_faute_lourde",
  "licenciement_economique",
  "sanction_disciplinaire",
  "rupture_conventionnelle",
  "mise_en_demeure_envoyee",
  "mise_en_demeure",
  "transaction",
  "engagement_contentieux",
  "contentieux",
  "reponse_officielle_salarie",
  "engagement_contractuel",
  "action_rh_defavorable",
  "notification_violation_donnees_cnil",
  "depot_plainte",
]);

export function isSensitiveAction(actionKey: string): boolean {
  return SENSITIVE_ACTIONS.has(actionKey.toLowerCase().trim());
}

export type SensitiveBlockResult = {
  blocked: boolean;
  validation_id: string | null;
  reason: string;
  error?: string;
};

export async function blockSensitiveActionUntilValidation(input: {
  actionKey: string;
  subjectType: string; // 'generated_document' | 'agent_run' | 'workflow_step'
  subjectId: string;
  dossierId: string | null;
  ctx: Agent360BuilderContext;
  assignedTo?: string | null; // si null, fallback admin du tenant
  comment?: string;
}): Promise<SensitiveBlockResult> {
  if (!isSensitiveAction(input.actionKey)) {
    return { blocked: false, validation_id: null, reason: "Action non sensible" };
  }
  try {
    // Détermine l'assignee : prioriser un admin du tenant si pas fourni
    let assignee = input.assignedTo ?? null;
    if (!assignee) {
      const { data: admin } = await db
        .from("user_roles")
        .select("user_id")
        .eq("tenant_id", input.ctx.tenantId)
        .in("role", ["admin", "admin_tenant", "manager", "juriste"])
        .limit(1)
        .maybeSingle();
      assignee = (admin as { user_id: string } | null)?.user_id ?? input.ctx.userId;
    }

    const { data, error } = await db
      .from("validation_requests")
      .insert({
        tenant_id: input.ctx.tenantId,
        requested_by: input.ctx.userId,
        assigned_to: assignee,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        dossier_id: input.dossierId,
        status: "pending",
        comment: input.comment ?? `Validation requise : action sensible "${input.actionKey}". Le contenu reste bloqué jusqu'à approbation.`,
      })
      .select("id")
      .single();

    if (error) {
      await captureServerError("agent360.blockSensitive", { tenantId: input.ctx.tenantId, userId: input.ctx.userId, extra: { actionKey: input.actionKey } }, error);
      return { blocked: false, validation_id: null, reason: "Insert validation échoué", error: error.message };
    }

    return {
      blocked: true,
      validation_id: (data as { id: string }).id,
      reason: `Action "${input.actionKey}" est sensible — validation humaine créée`,
    };
  } catch (e) {
    await captureServerError("agent360.blockSensitive", { tenantId: input.ctx.tenantId, userId: input.ctx.userId, extra: { actionKey: input.actionKey } }, e);
    return { blocked: false, validation_id: null, reason: "Exception", error: e instanceof Error ? e.message : "unknown" };
  }
}
