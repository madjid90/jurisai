// Shared auth helpers for Supabase Edge Functions.
// All sensitive functions (seed-*, connector-*, ingest-*) MUST call requireSuperAdmin().
// Standard user functions (legal-chat, etc.) call requireUser().
//
// Usage:
//   try {
//     const { userId, admin } = await requireSuperAdmin(req);
//     // ... protected logic
//   } catch (e) {
//     if (e instanceof AuthError) return e.toResponse(corsHeaders);
//     throw e;
//   }

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
  toResponse(corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify({ error: this.message }), {
      status: this.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

function getEnv() {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new AuthError("Missing Supabase env vars", 500);
  }
  return { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY };
}

export interface AuthContext {
  userId: string;
  email: string | null;
  userClient: SupabaseClient;
  admin: SupabaseClient;
}

export async function requireUser(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header", 401);
  }
  const token = authHeader.replace(/^Bearer\s+/i, "");

  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = getEnv();

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) {
    throw new AuthError("Invalid or expired session", 401);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    userClient,
    admin,
  };
}

export async function requireSuperAdmin(req: Request): Promise<AuthContext> {
  const ctx = await requireUser(req);
  const { data, error } = await ctx.admin
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error) {
    throw new AuthError(`Role check failed: ${error.message}`, 500);
  }
  if (!data) {
    throw new AuthError("Forbidden: super_admin role required", 403);
  }
  return ctx;
}
