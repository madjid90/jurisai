import { describe, it, expect, beforeEach } from "vitest";
import {
  withBreaker,
  callWithFallback,
  LlmBreakerOpenError,
  __resetBreakers,
} from "../llm-breaker.server";

describe("llm-breaker", () => {
  beforeEach(() => __resetBreakers());

  it("ouvre après 4 échecs upstream consécutifs", async () => {
    const fail = () => Promise.reject(new Error("upstream 503"));
    for (let i = 0; i < 4; i++) {
      await expect(withBreaker("m", fail)).rejects.toThrow(/503/);
    }
    // 5e appel : court-circuité
    await expect(withBreaker("m", fail)).rejects.toBeInstanceOf(LlmBreakerOpenError);
  });

  it("le succès remet à zéro le compteur", async () => {
    const fail = () => Promise.reject(new Error("upstream 500"));
    await expect(withBreaker("m", fail)).rejects.toThrow();
    await withBreaker("m", () => Promise.resolve("ok"));
    // compteur reset, on peut encore échouer 3 fois sans ouvrir
    for (let i = 0; i < 3; i++) {
      await expect(withBreaker("m", fail)).rejects.toThrow();
    }
    // toujours pas open
    await withBreaker("m", () => Promise.resolve("ok"));
  });

  it("callWithFallback bascule sur le secondaire si le primaire est open", async () => {
    // ouvre le primaire
    for (let i = 0; i < 4; i++) {
      await expect(
        withBreaker("primary", () => Promise.reject(new Error("upstream 503"))),
      ).rejects.toThrow();
    }

    const out = await callWithFallback("primary", "fallback", async (m) => `via:${m}`);
    expect(out.usedModel).toBe("fallback");
    expect(out.fellBack).toBe(true);
    expect(out.result).toBe("via:fallback");
  });

  it("ne fallback pas sur erreurs métier (non upstream)", async () => {
    await expect(
      callWithFallback("primary", "fallback", () => Promise.reject(new Error("validation_failed"))),
    ).rejects.toThrow(/validation_failed/);
  });
});
