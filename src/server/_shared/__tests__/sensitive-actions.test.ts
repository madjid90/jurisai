// Tests détection actions sensibles — V3 §19/§23.
// On mocke supabaseAdmin pour simuler un mini catalogue.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockData: Array<Record<string, unknown>> = [
  {
    action_key: "licenciement_faute_grave",
    action_label: "Licenciement pour faute grave",
    domain: "rh",
    severity: "critical",
    requires_human_validation: true,
    requires_lawyer: true,
    keywords: ["licenciement", "faute grave"],
    legal_refs: [{ code: "L1232-1" }],
  },
  {
    action_key: "mise_en_demeure",
    action_label: "Mise en demeure",
    domain: "commercial",
    severity: "high",
    requires_human_validation: true,
    requires_lawyer: false,
    keywords: ["mise en demeure"],
    legal_refs: [],
  },
  {
    action_key: "rappel_simple",
    action_label: "Rappel calendrier",
    domain: "general",
    severity: "low",
    requires_human_validation: false,
    requires_lawyer: false,
    keywords: ["rappel"],
    legal_refs: [],
  },
];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => Promise.resolve({ data: mockData, error: null }),
    }),
  },
}));

import { detectSensitiveActions } from "../sensitive-actions.server";

beforeEach(() => {
  // reset cache between tests via TTL bypass (5min) → on importe à neuf
  // pas nécessaire ici car cache est par-module et tests indépendants
});

describe("detectSensitiveActions", () => {
  it("ne détecte rien sur un workflow neutre", async () => {
    const r = await detectSensitiveActions([
      { key: "s1", title: "Préparer dossier client", description: "Collecter pièces" },
    ]);
    expect(r.contains_sensitive).toBe(false);
    expect(r.max_severity).toBe("none");
    expect(r.blocking).toBe(false);
  });

  it("détecte une action critique + bloque (requires_lawyer)", async () => {
    const r = await detectSensitiveActions([
      { key: "s1", title: "Convocation entretien préalable" },
      { key: "s2", title: "Notifier le licenciement pour faute grave" },
    ]);
    expect(r.contains_sensitive).toBe(true);
    expect(r.max_severity).toBe("critical");
    expect(r.blocking).toBe(true);
    expect(r.detected.map((d) => d.action_key)).toContain("licenciement_faute_grave");
  });

  it("détecte mise en demeure (high) — non bloquant car pas requires_lawyer", async () => {
    const r = await detectSensitiveActions([
      { key: "s1", title: "Envoyer mise en demeure au client défaillant" },
    ]);
    expect(r.max_severity).toBe("high");
    expect(r.blocking).toBe(false);
    expect(r.detected[0].severity).toBe("high");
  });

  it("normalise accents et casse (insensible)", async () => {
    const r = await detectSensitiveActions([
      { key: "s1", title: "MISE EN DEMEURE FORMELLE" },
    ]);
    expect(r.contains_sensitive).toBe(true);
  });

  it("agrège plusieurs matches sur la même action_key", async () => {
    const r = await detectSensitiveActions([
      { key: "s1", title: "Lettre de licenciement", description: "Faute grave caractérisée" },
    ]);
    const lic = r.detected.find((d) => d.action_key === "licenciement_faute_grave");
    expect(lic).toBeDefined();
    // matched_in contient au moins une occurrence (title)
    expect(lic!.matched_in.length).toBeGreaterThanOrEqual(1);
  });
});
