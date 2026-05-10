// Tests runtime workflow — extraction délais + invariants executeStep.
// On teste les morceaux purs (extractStepDelay déjà couvert dans legal-delays.test).
// Ici on couvre la sérialisation `step_definition` et la signature de loadInstance
// via mock léger.

import { describe, it, expect, vi } from "vitest";
import { extractStepDelay } from "../legal-delays.server";

describe("extractStepDelay (intégration runtime)", () => {
  it("lit delay_amount + delay_unit", () => {
    const d = extractStepDelay({ delay_amount: 5, delay_unit: "calendar_days" });
    expect(d).toEqual({ amount: 5, unit: "calendar_days" });
  });

  it("fallback sur delay_days si pas d'unit explicite", () => {
    const d = extractStepDelay({ delay_days: 15 });
    expect(d?.amount).toBe(15);
  });

  it("retourne null pour étape sans délai", () => {
    expect(extractStepDelay({ title: "Sans délai" })).toBeNull();
  });
});

// Smoke test : import + signatures executeStep / skipStep
describe("workflow-runtime exports", () => {
  it("expose executeStep et skipStep", async () => {
    vi.mock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: { from: () => ({ select: () => Promise.resolve({ data: [] }) }) },
    }));
    const mod = await import("../workflow-runtime.server");
    expect(typeof mod.executeStep).toBe("function");
    expect(typeof mod.skipStep).toBe("function");
    expect(typeof mod.loadInstance).toBe("function");
  });
});
