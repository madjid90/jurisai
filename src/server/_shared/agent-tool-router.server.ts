// Router central des tool calls de l'agent JurisAI.
// Extrait du switch historique de agent.functions.ts pour permettre la réutilisation
// (boucle agentique principale, replays, tests). Toujours typé via AgentCtx + ToolOutcome.
import {
  type AgentCtx,
  type ToolOutcome,
  searchLaw,
  dossierContext,
  identifyRisk,
  proposeDocument,
  requestValidation,
  scheduleReminder,
  createTask,
  createDeadline,
  searchDossier,
  updateTask,
  createDossierTool,
  startWorkflowTool,
  analyzeDocumentTool,
  generateReportTool,
  generateWorkflowTool,
  runWorkflowStepTool,
  calculateIndemnityTool,
} from "./agent-tools.server";
import { compareContracts } from "./contract-compare.server";

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: AgentCtx,
) => Promise<ToolOutcome>;

const HANDLERS: Record<string, ToolHandler> = {
  search_law: (a, c) => searchLaw(String(a.query ?? ""), c),
  dossier_context: (a, c) => dossierContext(String(a.dossier_id ?? ""), c),
  identify_risk: (a, c) =>
    identifyRisk(
      {
        dossier_id: String(a.dossier_id ?? ""),
        title: String(a.title ?? ""),
        severity: String(a.severity ?? "medium"),
        legal_basis: a.legal_basis ? String(a.legal_basis) : undefined,
        description: a.description ? String(a.description) : undefined,
      },
      c,
    ),
  propose_document: (a, c) =>
    proposeDocument(
      {
        dossier_id: String(a.dossier_id ?? ""),
        doc_type: String(a.doc_type ?? ""),
        domain: a.domain ? String(a.domain) : undefined,
        params: (a.params as Record<string, unknown>) ?? undefined,
      },
      c,
    ),
  request_validation: (a, c) =>
    requestValidation(
      {
        dossier_id: String(a.dossier_id ?? ""),
        action_type: String(a.action_type ?? ""),
        reason: a.reason ? String(a.reason) : undefined,
        payload: (a.payload as Record<string, unknown>) ?? undefined,
      },
      c,
    ),
  schedule_reminder: (a, c) =>
    scheduleReminder(
      {
        dossier_id: a.dossier_id ? String(a.dossier_id) : undefined,
        title: String(a.title ?? ""),
        remind_at: String(a.remind_at ?? ""),
        channel: a.channel ? String(a.channel) : undefined,
      },
      c,
    ),
  create_task: (a, c) =>
    createTask(
      {
        dossier_id: String(a.dossier_id ?? ""),
        title: String(a.title ?? ""),
        priority: a.priority ? String(a.priority) : undefined,
        due_date: a.due_date ? String(a.due_date) : undefined,
      },
      c,
    ),
  create_deadline: (a, c) =>
    createDeadline(
      {
        dossier_id: String(a.dossier_id ?? ""),
        title: String(a.title ?? ""),
        due_date: String(a.due_date ?? ""),
      },
      c,
    ),
  search_dossier: (a, c) =>
    searchDossier(
      {
        query: String(a.query ?? ""),
        limit: a.limit ? Number(a.limit) : undefined,
      },
      c,
    ),
  update_task: (a, c) =>
    updateTask(
      {
        task_id: String(a.task_id ?? ""),
        dossier_id: String(a.dossier_id ?? ""),
        status: a.status ? String(a.status) : undefined,
        priority: a.priority ? String(a.priority) : undefined,
        title: a.title ? String(a.title) : undefined,
      },
      c,
    ),
  create_dossier: (a, c) =>
    createDossierTool(
      {
        title: String(a.title ?? ""),
        category: a.category ? String(a.category) : undefined,
        description: a.description ? String(a.description) : undefined,
        client_id: a.client_id ? String(a.client_id) : undefined,
        risk_level: a.risk_level ? String(a.risk_level) : undefined,
      },
      c,
    ),
  start_workflow: (a, c) =>
    startWorkflowTool(
      {
        definition_id: a.definition_id ? String(a.definition_id) : undefined,
        definition_slug: a.definition_slug ? String(a.definition_slug) : undefined,
        title: a.title ? String(a.title) : undefined,
        dossier_id: a.dossier_id ? String(a.dossier_id) : undefined,
        client_id: a.client_id ? String(a.client_id) : undefined,
        context: (a.context as Record<string, unknown>) ?? undefined,
      },
      c,
    ),
  analyze_document: (a, c) =>
    analyzeDocumentTool(
      {
        document_id: String(a.document_id ?? ""),
        dossier_id: a.dossier_id ? String(a.dossier_id) : undefined,
      },
      c,
    ),
  generate_report: (a, c) =>
    generateReportTool(
      {
        dossier_id: String(a.dossier_id ?? ""),
        report_type: a.report_type ? String(a.report_type) : undefined,
      },
      c,
    ),
  generate_workflow: (a, c) =>
    generateWorkflowTool(
      {
        prompt: String(a.prompt ?? ""),
        category: a.category ? String(a.category) : undefined,
      },
      c,
    ),
  run_workflow_step: (a, c) =>
    runWorkflowStepTool(
      {
        instance_id: String(a.instance_id ?? ""),
        step_index: Number(a.step_index ?? 0),
        notes: a.notes ? String(a.notes) : undefined,
      },
      c,
    ),
  compare_contracts: async (a, c) => {
    try {
      const result = await compareContracts({
        docAId: String(a.doc_a_id ?? ""),
        docBId: String(a.doc_b_id ?? ""),
        ctx: { tenantId: c.tenantId, apiKey: c.apiKey },
      });
      return { result, succeeded: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "compare_contracts failed";
      return { result: { error: msg }, succeeded: false, errorMessage: msg };
    }
  },
  calculate_indemnity: (a, c) =>
    calculateIndemnityTool(
      {
        salaire_mensuel_brut: Number(a.salaire_mensuel_brut ?? 0),
        salaire_moyen_12m: a.salaire_moyen_12m ? Number(a.salaire_moyen_12m) : undefined,
        salaire_moyen_3m: a.salaire_moyen_3m ? Number(a.salaire_moyen_3m) : undefined,
        anciennete_mois: Number(a.anciennete_mois ?? 0),
        motif: String(a.motif ?? "licenciement_cause_reelle"),
        idcc: a.idcc ? String(a.idcc) : undefined,
        categorie: a.categorie ? String(a.categorie) : undefined,
        taille_entreprise: a.taille_entreprise ? String(a.taille_entreprise) : undefined,
        date_effet: a.date_effet ? String(a.date_effet) : undefined,
        jours_conges_non_pris: a.jours_conges_non_pris ? Number(a.jours_conges_non_pris) : undefined,
        dossier_id: a.dossier_id ? String(a.dossier_id) : undefined,
      },
      c,
    ),
};

export function listAvailableTools(): string[] {
  return Object.keys(HANDLERS);
}

export async function routeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentCtx,
): Promise<ToolOutcome> {
  const handler = HANDLERS[name];
  if (!handler) {
    return { result: { error: `Unknown tool: ${name}` }, succeeded: false };
  }
  try {
    return await handler(args, ctx);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : "tool failed";
    return { result: { error: errorMessage }, succeeded: false, errorMessage };
  }
}
