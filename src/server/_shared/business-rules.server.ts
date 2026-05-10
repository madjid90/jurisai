// Catalogue des règles métier (table business_rules).
// Source de vérité unique côté serveur ; le client peut conserver un fallback statique
// dans src/lib/agent/business-rules.ts pour SSR sans DB.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type BusinessRuleField = {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "textarea";
  placeholder?: string;
  hint?: string;
};

export type BusinessRuleRow = {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  domain: string;
  required_fields: BusinessRuleField[];
  risks: string[];
  steps: string[];
  validation_roles: string[];
  validation_sla_days: number | null;
  keywords: string[];
  is_sensitive: boolean;
  is_active: boolean;
};

let cache: { rows: BusinessRuleRow[]; at: number } | null = null;
const TTL_MS = 5 * 60_000;

export async function loadBusinessRules(force = false): Promise<BusinessRuleRow[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any)
    .from("business_rules")
    .select("*")
    .eq("is_active", true);
  if (error || !data) {
    return cache?.rows ?? [];
  }
  cache = { rows: data as BusinessRuleRow[], at: Date.now() };
  return cache.rows;
}

/** Sélectionne la règle métier la plus adaptée au texte fourni. */
export async function pickBusinessRule(haystack: string): Promise<BusinessRuleRow | null> {
  const rules = await loadBusinessRules();
  if (rules.length === 0) return null;
  const text = haystack.toLowerCase();
  for (const r of rules) {
    if (r.kind === "generic") continue;
    for (const kw of r.keywords ?? []) {
      try {
        const re = new RegExp(kw, "i");
        if (re.test(text)) return r;
      } catch {
        if (text.includes(String(kw).toLowerCase())) return r;
      }
    }
  }
  return rules.find((r) => r.kind === "generic") ?? null;
}
