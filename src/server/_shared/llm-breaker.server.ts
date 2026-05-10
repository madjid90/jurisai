// LOT 11 — Circuit breaker LLM + fallback model.
//
// État in-memory par modèle :
//   closed  → tout passe.
//   open    → court-circuite immédiatement (LlmBreakerOpenError) pendant cooldown.
//   half_open → autorise 1 essai sonde ; succès → closed, échec → open.
//
// Helpers :
//   - withBreaker(model, fn)        : wrap un appel LLM par son nom de modèle.
//   - callWithFallback(primary, fb, fn) : tente primary, retombe sur fallback.
//   - getBreakerSnapshot()          : pour debug / monitoring.

const FAILURE_THRESHOLD = 4; // ouvre après N échecs consécutifs
const COOLDOWN_MS = 30_000;  // durée open avant half_open

type BreakerState = "closed" | "open" | "half_open";
type Entry = {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
};

const breakers = new Map<string, Entry>();

function get(model: string): Entry {
  let e = breakers.get(model);
  if (!e) {
    e = { state: "closed", consecutiveFailures: 0, openedAt: null };
    breakers.set(model, e);
  }
  // open → half_open après cooldown
  if (e.state === "open" && e.openedAt && Date.now() - e.openedAt >= COOLDOWN_MS) {
    e.state = "half_open";
  }
  return e;
}

export class LlmBreakerOpenError extends Error {
  constructor(model: string) {
    super(`Circuit breaker ouvert pour modèle ${model}`);
    this.name = "LlmBreakerOpenError";
  }
}

function isFatalUpstream(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message || "";
  // 429 = rate limit, 5xx = upstream, timeout = LlmTimeoutError
  return (
    err.name === "LlmTimeoutError" ||
    /\b(429|500|502|503|504)\b/.test(m) ||
    /timeout|aborted|fetch failed|network/i.test(m)
  );
}

export async function withBreaker<T>(model: string, fn: () => Promise<T>): Promise<T> {
  const e = get(model);
  if (e.state === "open") {
    throw new LlmBreakerOpenError(model);
  }
  try {
    const out = await fn();
    // succès → reset
    e.state = "closed";
    e.consecutiveFailures = 0;
    e.openedAt = null;
    return out;
  } catch (err) {
    if (isFatalUpstream(err)) {
      e.consecutiveFailures += 1;
      if (e.state === "half_open" || e.consecutiveFailures >= FAILURE_THRESHOLD) {
        e.state = "open";
        e.openedAt = Date.now();
      }
    }
    throw err;
  }
}

/**
 * Tente l'appel sur `primary`. Si le breaker est ouvert ou si l'appel échoue
 * de manière "upstream" (timeout / 429 / 5xx), retombe sur `fallback`.
 */
export async function callWithFallback<T>(
  primaryModel: string,
  fallbackModel: string,
  call: (model: string) => Promise<T>,
): Promise<{ result: T; usedModel: string; fellBack: boolean }> {
  try {
    const result = await withBreaker(primaryModel, () => call(primaryModel));
    return { result, usedModel: primaryModel, fellBack: false };
  } catch (err) {
    if (err instanceof LlmBreakerOpenError || isFatalUpstream(err)) {
      if (fallbackModel && fallbackModel !== primaryModel) {
        const result = await withBreaker(fallbackModel, () => call(fallbackModel));
        return { result, usedModel: fallbackModel, fellBack: true };
      }
    }
    throw err;
  }
}

export function getBreakerSnapshot(): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const [k, v] of breakers.entries()) out[k] = { ...v };
  return out;
}

/** Test only. */
export function __resetBreakers() {
  breakers.clear();
}
