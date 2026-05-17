// Test : garde-fou auto-création validation_requests si requires_validation=true.
// Corrige l'audit Agent 360 : avant ce fix, 0 row dans validation_requests
// malgré 14 runs sensibles → le LLM n'invoquait jamais request_validation.

import { describe, it, expect, vi, beforeEach } from "vitest";

const insertCalls: Array<{ table: string; row: Record<string, unknown> }> = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        insertCalls.push({ table, row });
        return Promise.resolve({ error: null });
      },
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: { user_id: "admin-uuid" }, error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/server/_shared/business-rules.server", () => ({
  pickBusinessRule: vi.fn().mockReturnValue({
    kind: "redaction_document",
    title: "Lettre de licenciement",
    is_sensitive: true,
    validation_roles: ["admin_tenant", "juriste"],
    required_fields: [],
  }),
}));

vi.mock("../agent-memory.server", () => ({
  rememberMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../timeline.server", () => ({
  logTimelineEvent: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  insertCalls.length = 0;
});

describe("agent-post-response — validation auto", () => {
  it("crée automatiquement validation_requests quand intent sensible et LLM ne l'a pas fait", async () => {
    const { runPostResponsePipeline } = await import("../agent-post-response.server");

    await runPostResponsePipeline({
      agentRunId: "run-uuid",
      tenantId: "tenant-uuid",
      userId: "user-uuid",
      message: "Je veux licencier un salarié pour faute grave",
      answer: "Voici la procédure...",
      intent: "redaction_document",
      domain: "social",
      topic: "licenciement",
      trace: [
        // Aucune ligne avec validation_request_id → garde-fou doit déclencher
        { tool: "search_law", sensitive: false, validation_request_id: null },
      ],
      refused: false,
      dossierId: "dossier-uuid",
    });

    const validationInsert = insertCalls.find((c) => c.table === "validation_requests");
    expect(validationInsert).toBeDefined();
    expect(validationInsert?.row.subject_type).toBe("agent_run");
    expect(validationInsert?.row.subject_id).toBe("run-uuid");
    expect(validationInsert?.row.status).toBe("pending");
    expect(validationInsert?.row.assigned_to).toBe("admin-uuid");
  });

  it("ne crée PAS de validation_request si le LLM en a déjà créé une via tool", async () => {
    const { runPostResponsePipeline } = await import("../agent-post-response.server");

    await runPostResponsePipeline({
      agentRunId: "run-uuid",
      tenantId: "tenant-uuid",
      userId: "user-uuid",
      message: "test",
      answer: "test",
      intent: "redaction_document",
      domain: "social",
      topic: "licenciement",
      trace: [
        { tool: "request_validation", sensitive: true, validation_request_id: "existing-vr-uuid" },
      ],
      refused: false,
      dossierId: "dossier-uuid",
    });

    const validationInsert = insertCalls.find((c) => c.table === "validation_requests");
    expect(validationInsert).toBeUndefined();
  });

  it("ne crée PAS de validation_request si refused=true (pas d'analyse)", async () => {
    const { runPostResponsePipeline } = await import("../agent-post-response.server");

    await runPostResponsePipeline({
      agentRunId: "run-uuid",
      tenantId: "tenant-uuid",
      userId: "user-uuid",
      message: "test",
      answer: "Réponse refusée",
      intent: "redaction_document",
      domain: "social",
      topic: "licenciement",
      trace: [],
      refused: true,
      dossierId: "dossier-uuid",
    });

    const validationInsert = insertCalls.find((c) => c.table === "validation_requests");
    expect(validationInsert).toBeUndefined();
  });
});
