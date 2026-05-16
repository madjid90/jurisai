// Helper unique pour les appels embeddings (Lovable AI Gateway).
//
// Centralise :
//  - retry/backoff sur 429 (rate-limit) et 5xx (transient)
//  - classification claire des erreurs (rate_limited / payment_required / unauthorized / upstream / network / empty)
//  - troncature dure (~30 000 chars) pour éviter les 400 silencieux
//  - timeout court (15 s) — embeddings doivent être rapides
//
// Toujours utiliser ce helper, jamais fetch() directement vers /embeddings.

import { llmFetch, LlmTimeoutError } from "./llm-fetch.server";
import { DEFAULT_EMBED_MODEL } from "./llm-models.server";

import { AI_GATEWAY, LLM_API_KEY } from "./constants.server";
const EMBED_MAX_CHARS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
// Délais exponentiels avec un peu de jitter, en ms.
const BASE_BACKOFF_MS = 400;

export type EmbedErrorKind =
  | "rate_limited" // 429
  | "payment_required" // 402
  | "unauthorized" // 401/403
  | "bad_request" // 400 (input invalide / trop long après troncature)
  | "upstream" // 5xx
  | "network" // fetch threw / DNS / abort hors timeout
  | "timeout" // LlmTimeoutError
  | "empty" // 200 mais data[0].embedding manquant
  | "no_api_key";

export type EmbedResult =
  | { ok: true; embedding: number[]; attempts: number; model: string }
  | { ok: false; kind: EmbedErrorKind; status?: number; detail?: string; attempts: number };

export type EmbedOptions = {
  model?: string;
  timeoutMs?: number;
  apiKey?: string;
  /** Pour logs structurés. */
  context?: string;
};

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * Math.min(250, ms / 2));
}

function classifyStatus(status: number): EmbedErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 402) return "payment_required";
  if (status === 401 || status === 403) return "unauthorized";
  if (status >= 500) return "upstream";
  return "bad_request";
}

function isRetryable(kind: EmbedErrorKind): boolean {
  return kind === "rate_limited" || kind === "upstream" || kind === "network" || kind === "timeout";
}

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asInt = Number(headerValue);
  if (Number.isFinite(asInt) && asInt > 0) return Math.min(asInt * 1000, 5_000);
  // HTTP-date — on ignore (rare ici), on retombera sur backoff exponentiel.
  return null;
}

/**
 * Embed un texte avec retry/backoff et erreurs typées.
 *
 * Ne throw jamais — renvoie toujours un EmbedResult que l'appelant gère
 * (refus motivé côté agent, fallback FTS côté RAG, etc.).
 */
export async function embedText(text: string, opts: EmbedOptions = {}): Promise<EmbedResult> {
  const apiKey = opts.apiKey ?? LLM_API_KEY;
  if (!apiKey) {
    return { ok: false, kind: "no_api_key", attempts: 0, detail: "LOVABLE_API_KEY missing" };
  }
  const model = opts.model ?? DEFAULT_EMBED_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const input = text.length > EMBED_MAX_CHARS ? text.slice(0, EMBED_MAX_CHARS) : text;
  const ctxLabel = opts.context ?? "embed";

  let lastErr: { kind: EmbedErrorKind; status?: number; detail?: string } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await llmFetch(
        `${AI_GATEWAY}/embeddings`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, input }),
        },
        { timeoutMs },
      );

      if (!res.ok) {
        const kind = classifyStatus(res.status);
        const bodyText = await res.text().catch(() => "");
        lastErr = { kind, status: res.status, detail: bodyText.slice(0, 500) };

        // 402 / 401 / 403 / 400 → pas de retry (faute persistante).
        if (!isRetryable(kind)) {
          console.warn(
            `[embed:${ctxLabel}] non-retryable ${res.status} (${kind}) attempt=${attempt}: ${bodyText.slice(0, 200)}`,
          );
          return { ok: false, kind, status: res.status, detail: bodyText.slice(0, 500), attempts: attempt };
        }

        // Retryable. Si 429 et Retry-After présent → respecter ; sinon backoff exp + jitter.
        if (attempt < MAX_ATTEMPTS) {
          const retryAfter = res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) : null;
          const wait = retryAfter ?? jitter(BASE_BACKOFF_MS * 2 ** (attempt - 1));
          console.warn(
            `[embed:${ctxLabel}] retryable ${res.status} (${kind}) attempt=${attempt}/${MAX_ATTEMPTS}, retry in ${wait}ms`,
          );
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }

        console.warn(
          `[embed:${ctxLabel}] exhausted retries on ${res.status} (${kind}): ${bodyText.slice(0, 200)}`,
        );
        return { ok: false, kind, status: res.status, detail: bodyText.slice(0, 500), attempts: attempt };
      }

      // 2xx
      const json = (await res.json().catch(() => null)) as
        | { data?: Array<{ embedding?: number[] }> }
        | null;
      const embedding = json?.data?.[0]?.embedding;
      if (!embedding || embedding.length === 0) {
        lastErr = { kind: "empty", detail: "data[0].embedding missing" };
        if (attempt < MAX_ATTEMPTS) {
          const wait = jitter(BASE_BACKOFF_MS * 2 ** (attempt - 1));
          console.warn(`[embed:${ctxLabel}] empty embedding attempt=${attempt}, retry in ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        return { ok: false, kind: "empty", attempts: attempt, detail: "data[0].embedding missing" };
      }

      return { ok: true, embedding, attempts: attempt, model };
    } catch (e) {
      const isTimeout = e instanceof LlmTimeoutError;
      const kind: EmbedErrorKind = isTimeout ? "timeout" : "network";
      const detail = e instanceof Error ? e.message : String(e);
      lastErr = { kind, detail };
      if (attempt < MAX_ATTEMPTS) {
        const wait = jitter(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        console.warn(
          `[embed:${ctxLabel}] ${kind} attempt=${attempt}/${MAX_ATTEMPTS}: ${detail} — retry in ${wait}ms`,
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      console.warn(`[embed:${ctxLabel}] exhausted retries on ${kind}: ${detail}`);
      return { ok: false, kind, detail, attempts: attempt };
    }
  }

  // Théoriquement inatteignable — tous les chemins return dans la boucle.
  return {
    ok: false,
    kind: lastErr?.kind ?? "network",
    detail: lastErr?.detail,
    status: lastErr?.status,
    attempts: MAX_ATTEMPTS,
  };
}

/**
 * Message court adapté à l'utilisateur final selon la cause.
 * Utilisé par l'agent pour le `result.error` du tool search_law.
 */
export function embedErrorMessage(kind: EmbedErrorKind): string {
  switch (kind) {
    case "rate_limited":
      return "Service IA saturé (trop de requêtes). Réessayez dans un instant.";
    case "payment_required":
      return "Crédits IA épuisés. Ajoutez des crédits dans Settings → Workspace → Usage.";
    case "unauthorized":
      return "Clé IA invalide ou expirée. Contactez le support.";
    case "bad_request":
      return "Requête d'embedding invalide.";
    case "upstream":
      return "Service IA indisponible (5xx).";
    case "timeout":
      return "Service IA n'a pas répondu à temps.";
    case "network":
      return "Erreur réseau lors de l'appel au service IA.";
    case "empty":
      return "Service IA a renvoyé un embedding vide.";
    case "no_api_key":
      return "Configuration IA manquante côté serveur.";
  }
}
