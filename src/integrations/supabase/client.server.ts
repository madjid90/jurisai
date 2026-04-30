import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

function resolveConfig() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  // Prefer JURISAI_* override only if it looks like a real JWT (>100 chars).
  // Otherwise fall back to the standard SUPABASE_SERVICE_ROLE_KEY.
  const jurisai = process.env.JURISAI_SUPABASE_SERVICE_ROLE_KEY;
  const standard = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key =
    jurisai && jurisai.length > 100
      ? jurisai
      : standard && standard.length > 100
      ? standard
      : jurisai ?? standard;
  return { url, key };
}

let _client: SupabaseClient<Database> | null = null;

function getClient(): SupabaseClient<Database> {
  if (_client) return _client;
  const { url, key } = resolveConfig();
  if (!url) {
    throw new Error(
      "[supabase] SUPABASE_URL (or VITE_SUPABASE_URL) is not set. Server cannot connect to Supabase.",
    );
  }
  if (!key || key.length < 100) {
    throw new Error(
      "[supabase] SUPABASE_SERVICE_ROLE_KEY (or JURISAI_SUPABASE_SERVICE_ROLE_KEY) is missing or invalid. Server-side admin operations require a valid service role JWT.",
    );
  }
  _client = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

// Lazy proxy: defers env validation until the admin client is actually used.
// This prevents a missing/invalid service role key from crashing every SSR
// render (including public pages like /cgu that don't need admin access).
export const supabaseAdmin = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const client = getClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = Reflect.get(client as any, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
