// LOT 8 — Tests routeTool : dispatch correct, gestion d'erreur, outil inconnu.
import { describe, it, expect, vi } from "vitest";

vi.mock("../agent-tools.server", () => {
  return {
    searchLaw: vi.fn(async (q: string) => ({ result: { hits: [q] }, succeeded: true })),
    dossierContext: vi.fn(async (id: string) => ({ result: { dossier_id: id }, succeeded: true })),
    identifyRisk: vi.fn(async () => ({ result: { risks: [] }, succeeded: true, isSensitive: false })),
    proposeDocument: vi.fn(async () => ({ result: { doc_id: "d1" }, succeeded: true, isSensitive: true, validationRequestId: "v1" })),
    requestValidation: vi.fn(async () => ({ result: { ok: true }, succeeded: true })),
    scheduleReminder: vi.fn(async () => ({ result: { ok: true }, succeeded: true })),
    createTask: vi.fn(async () => ({ result: { ok: true }, succeeded: true })),
    createDeadline: vi.fn(async () => ({ result: { ok: true }, succeeded: true })),
    searchDossier: vi.fn(async () => ({ result: { hits: [] }, succeeded: true })),
    createDossierTool: vi.fn(async () => ({ result: { id: "x" }, succeeded: true })),
    startWorkflowTool: vi.fn(async () => ({ result: { ok: true }, succeeded: true })),
    analyzeDocumentTool: vi.fn(async () => { throw new Error("LLM down"); }),
    generateReportTool: vi.fn(async () => ({ result: { ok: true }, succeeded: true })),
    generateWorkflowTool: vi.fn(async () => ({ result: { ok: true }, succeeded: true })),
    runWorkflowStepTool: vi.fn(async () => ({ result: { ok: true }, succeeded: true })),
  };
});

import { routeTool, listAvailableTools } from "../agent-tool-router.server";

const ctx = {
  userId: "u1",
  tenantId: "t1",
  idcc: null,
  apiKey: "k",
  sources: [],
};

describe("routeTool", () => {
  it("liste les outils disponibles (15)", () => {
    const tools = listAvailableTools();
    expect(tools.length).toBeGreaterThanOrEqual(15);
    expect(tools).toContain("search_law");
    expect(tools).toContain("propose_document");
  });

  it("dispatche search_law avec succès", async () => {
    const r = await routeTool("search_law", { query: "L1232-1" }, ctx);
    expect(r.succeeded).toBe(true);
    expect(r.result).toMatchObject({ hits: ["L1232-1"] });
  });

  it("propage isSensitive et validationRequestId depuis l'outil", async () => {
    const r = await routeTool("propose_document", { type: "lettre_licenciement" }, ctx);
    expect(r.succeeded).toBe(true);
    expect((r as { isSensitive?: boolean }).isSensitive).toBe(true);
    expect((r as { validationRequestId?: string | null }).validationRequestId).toBe("v1");
  });

  it("retourne succeeded=false pour un outil inconnu", async () => {
    const r = await routeTool("does_not_exist", {}, ctx);
    expect(r.succeeded).toBe(false);
    expect((r.result as { error: string }).error).toMatch(/Unknown tool/);
  });

  it("capture les exceptions tool en error wrap", async () => {
    const r = await routeTool("analyze_document", {}, ctx);
    expect(r.succeeded).toBe(false);
    expect(r.errorMessage).toMatch(/LLM down/);
  });
});
