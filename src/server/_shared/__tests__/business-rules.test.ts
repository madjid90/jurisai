// LOT 8 — Tests business_rules : matching keyword + fallback générique.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: Array<Record<string, unknown>> = [
  {
    id: "r1",
    kind: "rh.licenciement",
    title: "Licenciement pour faute",
    subtitle: null,
    domain: "rh",
    required_fields: [
      { key: "salarie", label: "Salarié concerné" },
      { key: "motif", label: "Motif détaillé" },
    ],
    risks: ["Contentieux prud'homal"],
    steps: ["Convocation", "Entretien", "Notification"],
    validation_roles: ["admin", "lawyer"],
    validation_sla_days: 5,
    keywords: ["licenciement", "faute grave"],
    is_sensitive: true,
    is_active: true,
  },
  {
    id: "r2",
    kind: "commercial.mise_en_demeure",
    title: "Mise en demeure",
    subtitle: null,
    domain: "commercial",
    required_fields: [{ key: "debiteur", label: "Débiteur" }],
    risks: [],
    steps: [],
    validation_roles: ["admin"],
    validation_sla_days: 3,
    keywords: ["mise en demeure", "impayé"],
    is_sensitive: false,
    is_active: true,
  },
  {
    id: "r3",
    kind: "generic",
    title: "Règle générique",
    subtitle: null,
    domain: "general",
    required_fields: [],
    risks: [],
    steps: [],
    validation_roles: [],
    validation_sla_days: null,
    keywords: [],
    is_sensitive: false,
    is_active: true,
  },
];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  },
}));

beforeEach(async () => {
  // Reset cache module-level entre tests
  vi.resetModules();
});

describe("pickBusinessRule", () => {
  it("matche la règle licenciement sur 'faute grave'", async () => {
    const { pickBusinessRule } = await import("../business-rules.server");
    const r = await pickBusinessRule("Préparer un licenciement pour faute grave d'un salarié");
    expect(r?.kind).toBe("rh.licenciement");
  });

  it("matche la règle mise en demeure sur 'impayé'", async () => {
    const { pickBusinessRule } = await import("../business-rules.server");
    const r = await pickBusinessRule("Client en impayé depuis 3 mois");
    expect(r?.kind).toBe("commercial.mise_en_demeure");
  });

  it("retombe sur la règle générique si aucun mot-clé ne matche", async () => {
    const { pickBusinessRule } = await import("../business-rules.server");
    const r = await pickBusinessRule("Question administrative random sans signal");
    expect(r?.kind).toBe("generic");
  });
});

describe("loadBusinessRules", () => {
  it("retourne uniquement les règles actives", async () => {
    const { loadBusinessRules } = await import("../business-rules.server");
    const all = await loadBusinessRules(true);
    expect(all.length).toBe(3);
    expect(all.every((r) => r.is_active)).toBe(true);
  });
});
