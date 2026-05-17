import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Browser uses VITE_* (replaced at build time). Server uses process.env (read at runtime).
// We resolve lazily so missing server env throws at first use, not at module load.
const SUPABASE_URL =
  (typeof window !== "undefined"
    ? import.meta.env.VITE_SUPABASE_URL
    : process.env.SUPABASE_URL) ?? "";
const SUPABASE_PUBLISHABLE_KEY =
  (typeof window !== "undefined"
    ? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    : process.env.SUPABASE_PUBLISHABLE_KEY) ?? "";

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "[auth-middleware] Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY env var",
  );
}

let refreshSessionPromise: Promise<string | null> | null = null;

function isUnauthorizedError(status: number | undefined, message: string) {
  return status === 401 || /invalid token|invalid jwt|jwt|expired|unauthorized/i.test(message);
}

function isJwtVerificationUnauthorized(message: string) {
  // Audit fix : avant on matchait /exp/ tout court → tout message contenant
  // "exp" (ex: "expect", "experiment", "expected") déclenchait un logout.
  // Patterns stricts maintenant : jwt expired, exp claim, JWS verification, etc.
  return /signature verification failed|token missing sub claim|jwt expired|"exp" claim|exp claim timestamp|expired|invalid signature|malformed jwt|jws|unexpected "(?:iss|aud|nbf)"/i.test(
    message,
  );
}

function isSupabaseAuthUnavailable(status: number | undefined, message: string) {
  return (
    (typeof status === "number" && status >= 500) ||
    /auth service unavailable|database error querying schema|unexpected eof|database in recovery|failed to fetch|no connection to the server|temporarily unavailable|service unavailable/i.test(
      message,
    )
  );
}

async function refreshBrowserAccessToken() {
  if (refreshSessionPromise) return refreshSessionPromise;

  refreshSessionPromise = (async () => {
    try {
      const { supabase } = await import("./client");
      const { data, error } = await supabase.auth.refreshSession();

      if (!error && data.session?.access_token) {
        return data.session.access_token;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      return session?.access_token ?? null;
    } catch {
      return null;
    }
  })().finally(() => {
    refreshSessionPromise = null;
  });

  return refreshSessionPromise;
}

/**
 * Server function middleware that:
 * 1. Reads the Authorization header from the incoming request
 * 2. Verifies the JWT against Supabase
 * 3. Provides an authenticated supabase client (RLS applies as the user)
 * 4. Throws if no valid session
 */
export const requireSupabaseAuth = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    let token: string | null = null;

    if (typeof window !== "undefined") {
      // Audit fix : si la session n'est pas encore prête (cas typique après reload),
      // on attend jusqu'à 800ms (4 tentatives de 200ms) avant de partir sans token.
      // Avant : 1 call serveur sans header → "UNAUTHORIZED: missing access token"
      // → écran d'erreur immédiat alors que la session arrivait 100ms après.
      const { supabase } = await import("./client");
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const { data, error } = await supabase.auth.getSession();
          if (!error && data.session?.access_token) {
            token = data.session.access_token;
            break;
          }
        } catch {
          // ignore, on retry
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 200));
      }
    }

    try {
      return await next({
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } catch (err) {
      // If server rejects the token, force a session refresh and retry once.
      const msg = err instanceof Error ? err.message : String(err);
      // Audit fix : élargi pour matcher aussi "missing access token" (token null au 1er call)
      if (typeof window !== "undefined" && /UNAUTHORIZED:\s*(?:invalid|missing)\s*(?:access\s*)?token/i.test(msg)) {
        try {
          const { supabase } = await import("./client");

          const fresh = await refreshBrowserAccessToken();
          if (fresh) {
            return await next({ headers: { Authorization: `Bearer ${fresh}` } });
          }

          // Refresh failed → sign out so user re-authenticates cleanly
          await supabase.auth.signOut();
          if (!window.location.pathname.startsWith("/login")) {
            window.location.href = "/login";
          }
        } catch {
          /* fallthrough */
        }
      }
      throw err;
    }
  })
  .server(async ({ next }) => {
    const headerToken = getRequestHeader("authorization")?.replace(/^Bearer\s+/i, "");
    const accessToken = headerToken ?? null;

    if (!accessToken) {
      throw new Error("UNAUTHORIZED: missing access token");
    }

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    let verifiedUserId: string;
    let verifiedUserEmail: string | null;

    const { canVerifySupabaseAccessTokenLocally, verifySupabaseAccessToken } = await import("./jwt.server");

    if (canVerifySupabaseAccessTokenLocally(accessToken)) {
      try {
        const verified = await verifySupabaseAccessToken(accessToken);
        verifiedUserId = verified.userId;
        verifiedUserEmail = verified.userEmail;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isJwtVerificationUnauthorized(message)) {
          throw new Error("UNAUTHORIZED: invalid token");
        }

        throw new Error(
          `AUTH_SERVICE_UNAVAILABLE: ${message.replace(/^JWT_VERIFICATION_FAILED:\s*/i, "") || "failed to verify session"}`,
        );
      }
    } else {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(accessToken);

      if (error) {
        const status = typeof error.status === "number" ? error.status : undefined;
        const message = error.message ?? "failed to verify session";

        if (isUnauthorizedError(status, message)) {
          throw new Error("UNAUTHORIZED: invalid token");
        }

        if (isSupabaseAuthUnavailable(status, message)) {
          throw new Error(`AUTH_SERVICE_UNAVAILABLE: ${message}`);
        }

        throw new Error(`AUTH_SERVICE_UNAVAILABLE: ${message}`);
      }

      if (!user?.id) {
        throw new Error("UNAUTHORIZED: invalid token");
      }

      verifiedUserId = user.id;
      verifiedUserEmail = user.email ?? null;
    }

    return next({
      context: {
        supabase,
        userId: verifiedUserId,
        userEmail: verifiedUserEmail,
      },
    });
  });
