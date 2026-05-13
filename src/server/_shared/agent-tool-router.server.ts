// Router central des tool calls de l'agent JurisAI.
// Extrait du switch historique de agent.functions.ts pour permettre la réutilisation
// (boucle agentique principale, replays, tests). Toujours typé via AgentCtx + ToolOutcome.
// TODO: Remove `as never` casts — each handler should properly type its arguments

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
  createDossierTool,
  startWorkflowTool,
  analyzeDocumentTool,
  generateReportTool,
  generateWorkflowTool,
  runWorkflowStepTool,
} from "./agent-tools.server";

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: AgentCtx,
) => Promise<ToolOutcome>;

const HANDLERS: Record<string, ToolHandler> = {
  search_law: (a, c) => searchLaw(String(a.query ?? ""), c),
  dossier_context: (a, c) => dossierContext(String(a.dossier_id ?? ""), c),
  identify_risk: (a, c) => identifyRisk(a as never, c),
  propose_document: (a, c) => proposeDocument(a as never, c),
  request_validation: (a, c) => requestValidation(a as never, c),
  schedule_reminder: (a, c) => scheduleReminder(a as never, c),
  create_task: (a, c) => createTask(a as never, c),
  create_deadline: (a, c) => createDeadline(a as never, c),
  search_dossier: (a, c) => searchDossier(a as never, c),
  create_dossier: (a, c) => createDossierTool(a as never, c),
  start_workflow: (a, c) => startWorkflowTool(a as never, c),
  analyze_document: (a, c) => analyzeDocumentTool(a as never, c),
  generate_report: (a, c) => generateReportTool(a as never, c),
  generate_workflow: (a, c) => generateWorkflowTool(a as { prompt: string; category?: string }, c),
  run_workflow_step: (a, c) => runWorkflowStepTool(a as never, c),
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
