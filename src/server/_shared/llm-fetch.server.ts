// Helper unique pour tous les appels LLM côté serveur (Lovable AI Gateway).
//
// BUG-A12 (audit) : tout appel LLM doit avoir un timeout dur (sinon un appel
// pendu bloque la fonction serveur jusqu'au timeout du runtime).
//
// Utilisation :
//   const res = await llmFetch(`${AI_GATEWAY}/chat/completions`, {
//     method: "POST",
//     headers: { ... },
//     body: JSON.stringify(...),
//   }, { timeoutMs: 60_000 });

export type LlmFetchOptions = {
  /** Timeout en ms — défaut 60 000. */
  timeoutMs?: number;
  /** Signal externe (compose avec le timeout interne). */
  externalSignal?: AbortSignal;
};

export class LlmTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Appel LLM annulé après ${Math.round(timeoutMs / 1000)}s (timeout).`);
    this.name = "LlmTimeoutError";
  }
}

export async function llmFetch(
  url: string,
  init: RequestInit = {},
  opts: LlmFetchOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Compose externalSignal + timeout
  if (opts.externalSignal) {
    if (opts.externalSignal.aborted) controller.abort();
    else opts.externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && (e.name === "AbortError" || e.message.includes("aborted"))) {
      throw new LlmTimeoutError(timeoutMs);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
