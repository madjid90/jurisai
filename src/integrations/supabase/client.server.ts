import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://yuvysjsyumxpekzvlzsx.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.JURISAI_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] SUPABASE_SERVICE_ROLE_KEY is not set. Admin operations will fail.",
  );
}

export const supabaseAdmin = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY ?? "missing-service-role-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
