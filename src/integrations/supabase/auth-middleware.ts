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

/**
 * Server function middleware that:
 * 1. Reads the Authorization header from the incoming request
 * 2. Verifies the JWT against Supabase
 * 3. Provides an authenticated supabase client (RLS applies as the user)
 * 4. Throws if no valid session
 */
export const requireSupabaseAuth = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    // Forward the user's access token in the Authorization header.
    // Do not send it in server-fn context, especially for GET calls, because
    // TanStack serializes context into the request payload/URL.
    let token: string | null = null;
    if (typeof window !== "undefined") {
      try {
        const { supabase } = await import("./client");
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (!error && user) {
          const { data } = await supabase.auth.getSession();
          token = data.session?.access_token ?? null;
        }
      } catch {
        token = null;
      }
    }
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
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

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      throw new Error("UNAUTHORIZED: invalid token");
    }

    return next({
      context: {
        supabase,
        userId: user.id,
        userEmail: user.email ?? null,
      },
    });
  });
