import { describe, it, expect } from "vitest";
import {
  computeLegalDeadline,
  frHolidays,
  extractStepDelay,
} from "../legal-delays.server";

describe("frHolidays", () => {
  it("liste les 11 jours fériés métropole", () => {
    const h = frHolidays(2025);
    expect(h.size).toBe(11);
    expect(h.has("2025-01-01")).toBe(true); // Jour de l'an
    expect(h.has("2025-05-01")).toBe(true); // Fête du travail
    expect(h.has("2025-07-14")).toBe(true); // Fête nationale
    expect(h.has("2025-12-25")).toBe(true); // Noël
    // Pâques 2025 = 20 avril → Lundi de Pâques 21 avril
    expect(h.has("2025-04-21")).toBe(true);
  });
});

describe("computeLegalDeadline — calendar_days + art. 642", () => {
  it("ajoute des jours calendaires sans rollover si jour ouvré", () => {
    const r = computeLegalDeadline({
      startDate: "2025-01-06", // lundi
      amount: 5,
      unit: "calendar_days",
    });
    expect(r.dueDate).toBe("2025-01-11"); // samedi → rolled
    // En réalité 06+5=11 (sam) → rolled au 13 (lun)
    expect(r.rolled).toBe(true);
    expect(r.rollReason).toMatch(/samedi/);
  });

  it("rollForward au lundi si l'échéance tombe un dimanche", () => {
    const r = computeLegalDeadline({
      startDate: "2025-01-04", // sam
      amount: 1,
      unit: "calendar_days",
    });
    // 04+1 = 05 dim → rolled au 06 (lun)
    expect(r.dueDate).toBe("2025-01-06");
    expect(r.rolled).toBe(true);
  });

  it("rollForward désactivé si rollForward=false", () => {
    const r = computeLegalDeadline({
      startDate: "2025-01-04",
      amount: 1,
      unit: "calendar_days",
      rollForward: false,
    });
    expect(r.dueDate).toBe("2025-01-05");
    expect(r.rolled).toBe(false);
  });

  it("saute un jour férié pour rollover", () => {
    // 2025-05-01 (fête du travail, jeudi). Échéance 30 avril (mer) +1 = 1er mai → saute au 2 mai (ven)
    const r = computeLegalDeadline({
      startDate: "2025-04-30",
      amount: 1,
      unit: "calendar_days",
    });
    expect(r.dueDate).toBe("2025-05-02");
    expect(r.rollReason).toMatch(/férié/);
  });
});

describe("computeLegalDeadline — business_days", () => {
  it("compte uniquement L-V hors fériés", () => {
    // Lundi 2025-01-06, +5 ouvrés = lundi 2025-01-13 (week-end sauté)
    const r = computeLegalDeadline({
      startDate: "2025-01-06",
      amount: 5,
      unit: "business_days",
    });
    expect(r.dueDate).toBe("2025-01-13");
    expect(r.rolled).toBe(false);
  });

  it("saute férié intermédiaire", () => {
    // Mercredi 30 avril 2025, +2 ouvrés : 1er mai férié, 2 mai vendredi → due 5 mai (lundi)
    const r = computeLegalDeadline({
      startDate: "2025-04-30",
      amount: 2,
      unit: "business_days",
    });
    expect(r.dueDate).toBe("2025-05-05");
  });
});

describe("computeLegalDeadline — months (art. 641 CPC)", () => {
  it("ajoute 1 mois même quantième", () => {
    const r = computeLegalDeadline({
      startDate: "2025-01-15",
      amount: 1,
      unit: "months",
    });
    expect(r.dueDate).toBe("2025-02-15"); // sam → rolled au 17 lun
    expect(r.rolled).toBe(true);
  });

  it("clamp au dernier jour du mois si quantième inexistant (31 jan + 1 mois)", () => {
    const r = computeLegalDeadline({
      startDate: "2025-01-31",
      amount: 1,
      unit: "months",
    });
    // 28 février 2025 = vendredi
    expect(r.dueDate).toBe("2025-02-28");
  });
});

describe("extractStepDelay", () => {
  it("lit delay_amount + delay_unit", () => {
    expect(
      extractStepDelay({ delay_amount: 7, delay_unit: "jours ouvrés" }),
    ).toEqual({ amount: 7, unit: "business_days" });
  });

  it("lit delay_days seul (calendar)", () => {
    expect(extractStepDelay({ delay_days: 30 })).toEqual({
      amount: 30,
      unit: "calendar_days",
    });
  });

  it("retourne null si pas de délai", () => {
    expect(extractStepDelay({})).toBeNull();
    expect(extractStepDelay(null)).toBeNull();
  });

  it("normalise 'mois'", () => {
    expect(
      extractStepDelay({ delay_amount: 2, delay_unit: "mois" }),
    ).toEqual({ amount: 2, unit: "months" });
  });
});
