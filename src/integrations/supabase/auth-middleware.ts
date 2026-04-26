import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://yuvysjsyumxpekzvlzsx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_TYnoA8I5fLvsIfth34kcUg_WEzx2SsB";

/**
 * Server function middleware that:
 * 1. Reads the Authorization header from the incoming request
 * 2. Verifies the JWT against Supabase
 * 3. Provides an authenticated supabase client (RLS applies as the user)
 * 4. Throws if no valid session
 */
export const requireSupabaseAuth = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    // Forward the user's access token to the server
    let token: string | null = null;
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(
        `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`,
      );
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { access_token?: string };
          token = parsed.access_token ?? null;
        } catch {
          token = null;
        }
      }
    }
    return next({
      sendContext: { accessToken: token },
    });
  })
  .server(async ({ next, context }) => {
    const ctx = context as { accessToken?: string | null };
    const headerToken = getRequestHeader("authorization")?.replace(/^Bearer\s+/i, "");
    const accessToken = ctx.accessToken ?? headerToken ?? null;

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
