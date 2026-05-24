// Tests unitaires pour la logique métier de validation hiérarchique.
// On teste decideValidationCore (fonction pure) — la couche TanStack Start
// (createServerFn) n'a pas besoin de test, elle ne fait que parser + déléguer.

import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const dataStore: Record<string, Row[]> = {};
const operations: Array<{ table: string; op: string; payload?: unknown }> = [];

function makeChain(table: string) {
  const filters: Row = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: () => chain,
    insert: (payload: Row) => {
      operations.push({ table, op: "insert", payload });
      dataStore[table] = dataStore[table] ?? [];
      dataStore[table].push(payload);
      return Promise.resolve({ data: null, error: null });
    },
    update: (payload: Row) => {
      operations.push({ table, op: "update", payload });
      // Mutation simple : on applique aux lignes correspondantes
      const rows = dataStore[table] ?? [];
      for (const r of rows) {
        if (Object.entries(filters).every(([k, v]) => r[k] === v)) {
          Object.assign(r, payload);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const next: any = {
        eq: () => next,
        then: (cb: (v: { data: null; error: null }) => unknown) =>
          cb({ data: null, error: null }),
      };
      return next;
    },
    eq: (key: string, value: unknown) => {
      filters[key] = value;
      return chain;
    },
    in: () => Promise.resolve({ data: dataStore[table] ?? [], error: null }),
    order: () => chain,
    limit: () => Promise.resolve({ data: dataStore[table] ?? [], error: null }),
    maybeSingle: () => {
      const rows = (dataStore[table] ?? []).filter((r) =>
        Object.entries(filters).every(([k, v]) => r[k] === v),
      );
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then: (cb: (v: { data: Row[]; error: null }) => unknown) =>
      cb({
        data: (dataStore[table] ?? []).filter((r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v),
        ),
        error: null,
      }),
  };
  return chain;
}

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: () => ({}),
}));

vi.mock("@/server/_shared/tenant.server", () => ({
  getTenantId: () => Promise.resolve("tenant-1"),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
  },
}));

vi.mock("@/server/_shared/timeline.server", () => ({
  logTimelineEvent: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  Object.keys(dataStore).forEach((k) => delete dataStore[k]);
  operations.length = 0;
});

import { decideValidationCore } from "../validations.functions";

const ctxValidator = { userId: "drh", tenantId: "tenant-1" };

describe("decideValidationCore — règles métier", () => {
  it("refuse si l'utilisateur n'a aucun rôle habilité", async () => {
    dataStore["user_roles"] = [
      { user_id: "user-noobs", tenant_id: "tenant-1", role: "viewer" },
    ];

    await expect(
      decideValidationCore(
        { validationId: "val-1", approved: true },
        { userId: "user-noobs", tenantId: "tenant-1" },
      ),
    ).rejects.toThrow(/permission refusée/i);
  });

  it("refuse l'auto-validation (demandeur ≠ décideur)", async () => {
    dataStore["user_roles"] = [{ user_id: "drh", tenant_id: "tenant-1", role: "admin" }];
    dataStore["validation_requests"] = [
      {
        id: "val-self",
        tenant_id: "tenant-1",
        dossier_id: "d1",
        requested_by: "drh", // même que le décideur
        subject_type: "generated_document",
        subject_id: "doc-1",
        status: "pending",
      },
    ];

    await expect(
      decideValidationCore(
        { validationId: "val-self", approved: true },
        ctxValidator,
      ),
    ).rejects.toThrow(/votre propre demande/i);
  });

  it("refuse une validation déjà décidée", async () => {
    dataStore["user_roles"] = [{ user_id: "drh", tenant_id: "tenant-1", role: "manager" }];
    dataStore["validation_requests"] = [
      {
        id: "val-done",
        tenant_id: "tenant-1",
        requested_by: "junior",
        subject_type: "agent_run",
        subject_id: "r1",
        status: "approved",
      },
    ];

    await expect(
      decideValidationCore(
        { validationId: "val-done", approved: true },
        ctxValidator,
      ),
    ).rejects.toThrow(/déjà décidée/i);
  });

  it("approuve correctement, propage status sur generated_documents, notifie", async () => {
    dataStore["user_roles"] = [{ user_id: "drh", tenant_id: "tenant-1", role: "manager" }];
    dataStore["validation_requests"] = [
      {
        id: "val-ok",
        tenant_id: "tenant-1",
        dossier_id: "d1",
        requested_by: "junior",
        subject_type: "generated_document",
        subject_id: "doc-1",
        status: "pending",
      },
    ];
    dataStore["generated_documents"] = [
      { id: "doc-1", tenant_id: "tenant-1", status: "pending_validation" },
    ];

    const r = await decideValidationCore(
      { validationId: "val-ok", approved: true, comment: "OK pour envoi" },
      ctxValidator,
    );
    expect(r.ok).toBe(true);
    expect(r.approved).toBe(true);

    // Update sur validation_requests
    const valUpd = operations.find(
      (o) => o.table === "validation_requests" && o.op === "update",
    );
    expect(valUpd).toBeTruthy();
    expect((valUpd!.payload as Row).status).toBe("approved");

    // Update sur generated_documents
    const docUpd = operations.find(
      (o) => o.table === "generated_documents" && o.op === "update",
    );
    expect(docUpd).toBeTruthy();
    expect((docUpd!.payload as Row).status).toBe("validated");

    // Notification au demandeur
    const notif = operations.find(
      (o) => o.table === "notifications" && o.op === "insert",
    );
    expect(notif).toBeTruthy();
    expect((notif!.payload as Row).user_id).toBe("junior");
  });

  it("refus → status=rejected + generated_documents=rejected", async () => {
    dataStore["user_roles"] = [{ user_id: "drh", tenant_id: "tenant-1", role: "manager" }];
    dataStore["validation_requests"] = [
      {
        id: "val-no",
        tenant_id: "tenant-1",
        dossier_id: "d2",
        requested_by: "junior",
        subject_type: "generated_document",
        subject_id: "doc-2",
        status: "pending",
      },
    ];
    dataStore["generated_documents"] = [
      { id: "doc-2", tenant_id: "tenant-1", status: "pending_validation" },
    ];

    const r = await decideValidationCore(
      { validationId: "val-no", approved: false, comment: "Mention obligatoire manquante" },
      ctxValidator,
    );
    expect(r.approved).toBe(false);

    const docUpd = operations.find(
      (o) => o.table === "generated_documents" && o.op === "update",
    );
    expect((docUpd!.payload as Row).status).toBe("rejected");
  });
});
