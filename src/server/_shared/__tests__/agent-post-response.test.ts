// LOT 8 — Tests pipeline post-réponse agent.
import { describe, it, expect, vi, beforeEach } from "vitest";

const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  },
}));

const pickRule = vi.fn();
vi.mock("../business-rules.server", () => ({
  pickBusinessRule: (...a: unknown[]) => pickRule(...a),
}));

vi.mock("../agent-memory.server", () => ({
  rememberMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../timeline.server", () => ({
  logTimelineEvent: vi.fn().mockResolvedValue(undefined),
}));

import { runPostResponsePipeline } from "../agent-post-response.server";

const baseInput = {
  tenantId: "t1",
  userId: "u1",
  agentRunId: "r1",
  message: "Je veux licencier Paul Martin pour faute grave",
  answer: "Voici la procédure de licenciement…",
  intent: "redaction_document",
  domain: "rh",
  topic: "Licenciement faute grave",
  trace: [] as Array<{ tool: string; sensitive: boolean; validation_request_id: string | null }>,
  refused: false,
};

beforeEach(() => {
  inserts.length = 0;
  pickRule.mockReset();
});

describe("runPostResponsePipeline", () => {
  it("skip si refused=true et journalise status=skipped", async () => {
    const r = await runPostResponsePipeline({ ...baseInput, refused: true });
    expect(r.status).toBe("skipped");
    expect(r.requires_validation).toBe(false);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("agent_post_checks");
    expect(inserts[0].row.status).toBe("skipped");
  });

  it("status=needs_info quand des champs requis sont absents", async () => {
    pickRule.mockResolvedValue({
      kind: "rh.licenciement",
      title: "Licenciement",
      required_fields: [
        { key: "salarie", label: "Salarié concerné" },
        { key: "motif", label: "Motif détaillé" },
      ],
      validation_roles: ["admin"],
      is_sensitive: false,
    });
    const r = await runPostResponsePipeline({
      ...baseInput,
      message: "rien",
      answer: "rien",
    });
    expect(r.status).toBe("needs_info");
    expect(r.missing_information.length).toBeGreaterThan(0);
  });

  it("status=needs_validation quand la règle est sensitive et tout est rempli", async () => {
    pickRule.mockResolvedValue({
      kind: "rh.licenciement",
      title: "Licenciement",
      required_fields: [{ key: "salarie", label: "Salarié" }],
      validation_roles: ["admin", "lawyer"],
      is_sensitive: true,
    });
    const r = await runPostResponsePipeline({
      ...baseInput,
      message: "le salarié Paul Martin",
      answer: "Le salarié sera notifié",
    });
    expect(r.status).toBe("needs_validation");
    expect(r.requires_validation).toBe(true);
    expect(r.validation_roles).toContain("admin");
  });

  it("force needs_validation si une trace sensitive n'a pas de validation_request_id", async () => {
    pickRule.mockResolvedValue(null);
    const r = await runPostResponsePipeline({
      ...baseInput,
      trace: [{ tool: "propose_document", sensitive: true, validation_request_id: null }],
    });
    expect(r.requires_validation).toBe(true);
    expect(r.status).toBe("needs_validation");
  });

  it("status=ok quand aucune règle, aucun manque, aucune sensitive", async () => {
    pickRule.mockResolvedValue(null);
    const r = await runPostResponsePipeline({ ...baseInput });
    expect(r.status).toBe("ok");
    expect(r.requires_validation).toBe(false);
  });
});
