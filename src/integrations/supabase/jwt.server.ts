import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWK,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";

type SupabaseJwtPayload = JWTPayload & {
  sub?: string;
  email?: string;
};

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").replace(
  /\/+$/,
  "",
);
const SUPABASE_ISSUER = `${SUPABASE_URL}/auth/v1`;

function parseSupabaseJwks(raw: string | undefined): JSONWebKeySet | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "keys" in parsed &&
      Array.isArray((parsed as { keys?: unknown }).keys)
    ) {
      return { keys: (parsed as { keys: JWK[] }).keys };
    }
    return { keys: [parsed as JWK] };
  } catch {
    return null;
  }
}

const localJwkSet = (() => {
  const jwks = parseSupabaseJwks(process.env.SUPABASE_JWKS);
  return jwks ? createLocalJWKSet(jwks) : null;
})();

const remoteJwkSet = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_ISSUER}/.well-known/jwks.json`))
  : null;

export async function verifySupabaseAccessToken(accessToken: string) {
  if (!SUPABASE_URL) {
    throw new Error("JWT_VERIFICATION_FAILED: missing SUPABASE_URL");
  }

  let lastError: unknown = null;

  for (const jwkSet of [localJwkSet, remoteJwkSet]) {
    if (!jwkSet) continue;

    try {
      const { payload } = await jwtVerify(accessToken, jwkSet, {
        issuer: SUPABASE_ISSUER,
        audience: "authenticated",
        clockTolerance: 5,
      });

      const claims = payload as SupabaseJwtPayload;
      if (!claims.sub) {
        throw new Error("JWT_VERIFICATION_FAILED: token missing sub claim");
      }

      return {
        claims,
        userEmail: typeof claims.email === "string" ? claims.email : null,
        userId: claims.sub,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error(`JWT_VERIFICATION_FAILED: ${message}`);
}