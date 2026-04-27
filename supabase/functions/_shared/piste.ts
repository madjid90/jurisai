// Shared OAuth2 client-credentials flow for PISTE (Légifrance).
// Token cache is per cold-start; PISTE tokens last ~1h.

const PISTE_OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const PISTE_OAUTH_SANDBOX = "https://sandbox-oauth.piste.gouv.fr/api/oauth/token";

let cached: { token: string; expiresAt: number } | null = null;

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

  const sandbox = Deno.env.get("PISTE_SANDBOX") === "1";
  const url = sandbox ? PISTE_OAUTH_SANDBOX : PISTE_OAUTH_URL;

  const res = await fetch(url, {
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
    throw new Error(`PISTE OAuth error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cached.token;
}

export const LEGIFRANCE_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";
export const LEGIFRANCE_SANDBOX = "https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app";

export function legifranceBase(): string {
  return Deno.env.get("PISTE_SANDBOX") === "1" ? LEGIFRANCE_SANDBOX : LEGIFRANCE_BASE;
}

export async function legifranceFetch<T>(path: string, body: unknown): Promise<T> {
  const token = await getPisteToken();
  const res = await fetch(`${legifranceBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Légifrance ${path} ${res.status}: ${txt.slice(0, 300)}`);
  }
  return await res.json() as T;
}
