import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const SUPABASE_URL = "https://yuvysjsyumxpekzvlzsx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_TYnoA8I5fLvsIfth34kcUg_WEzx2SsB";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});
