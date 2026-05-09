// Shared OAuth2 client-credentials flow for PISTE (Légifrance).
// Token cache is per cold-start; PISTE tokens last ~1h.

const PISTE_OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const PISTE_OAUTH_SANDBOX = "https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token";

let cached: { token: string; expiresAt: number; env: "prod" | "sandbox" } | null = null;

export async function getPisteToken(scope = "openid"): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const id = Deno.env.get("LEGIFRANCE_OAUTH_ID");
  const secret = Deno.env.get("LEGIFRANCE_OAUTH_SECRET");
  if (!id || !secret) {
    throw new Error(
      "LEGIFRANCE_OAUTH_ID / LEGIFRANCE_OAUTH_SECRET manquants. " +
      "Inscrivez-vous sur https://piste.gouv.fr et ajoutez les secrets dans Supabase.",
    );
  }

  const forcedSandbox = Deno.env.get("PISTE_SANDBOX") === "1";
  const candidates: Array<{ env: "prod" | "sandbox"; url: string }> = forcedSandbox
    ? [{ env: "sandbox", url: PISTE_OAUTH_SANDBOX }]
    : [
      { env: "prod", url: PISTE_OAUTH_URL },
      { env: "sandbox", url: PISTE_OAUTH_SANDBOX },
    ];

  const errors: string[] = [];
  for (const candidate of candidates) {
    const res = await fetch(candidate.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: id,
        client_secret: secret,
        scope,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      errors.push(`${candidate.env}:${res.status}:${txt.slice(0, 160)}`);
      continue;
    }

    const json = await res.json() as { access_token: string; expires_in: number };
    cached = {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
      env: candidate.env,
    };
    return cached.token;
  }

  throw new Error(`PISTE OAuth failed (${errors.join(" | ")})`);
}

export const LEGIFRANCE_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";
export const LEGIFRANCE_SANDBOX = "https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app";

export function legifranceBases(): string[] {
  if (Deno.env.get("PISTE_SANDBOX") === "1") return [LEGIFRANCE_SANDBOX];
  if (cached?.env === "sandbox") return [LEGIFRANCE_SANDBOX, LEGIFRANCE_BASE];
  return [LEGIFRANCE_BASE, LEGIFRANCE_SANDBOX];
}

export async function legifranceFetch<T>(path: string, body: unknown): Promise<T> {
  const token = await getPisteToken();
  const errors: string[] = [];

  const apiKey = Deno.env.get("PISTE_API_KEY");
  for (const base of legifranceBases()) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (apiKey) headers.apikey = apiKey;
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (res.ok) {
      return await res.json() as T;
    }
    const txt = await res.text();
    errors.push(`${base} -> ${res.status}: ${txt.slice(0, 200)}`);
  }

  throw new Error(`Légifrance ${path} failed (${errors.join(" | ")})`);
}
