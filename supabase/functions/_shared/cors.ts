// Centralized CORS helper for edge functions.
// Uses an allowlist instead of wildcard "*" to reduce CSRF / origin abuse risk.

const DEFAULT_ALLOWED = [
  "https://id-preview--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app",
  "https://07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovableproject.com",
  "https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0.lovable.app",
  "https://project--07b3f0ab-4818-46f6-ad14-d5ed0b237ec0-dev.lovable.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
];

function getAllowedOrigins(): string[] {
  const extra = (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED, ...extra])];
}

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = getAllowedOrigins();
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

/** Backwards-compat default (wildcard fallback when no Request is available). */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
