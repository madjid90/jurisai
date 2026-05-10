// Détection d'actions sensibles dans un workflow généré.
// Source de vérité = table public.sensitive_actions_catalog (200+ entrées
// possibles, seed initial ~25). Matching par mot-clé sur titres/descriptions
// d'étapes + template_slugs. Renvoie les actions détectées + sévérité max.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SensitiveAction = {
  action_key: string;
  action_label: string;
  domain: string;
  severity: "low" | "medium" | "high" | "critical";
  requires_human_validation: boolean;
  requires_lawyer: boolean;
  matched_in: Array<{ step_index: number; step_key: string; field: "title" | "description" | "template_slug" | "kind"; matched_keyword: string }>;
  legal_refs: Array<{ code?: string; source?: string }>;
};

export type WorkflowStepLike = {
  key?: string;
  title?: string;
  description?: string;
  template_slug?: string;
  kind?: string;
};

export type SensitiveDetectionResult = {
  detected: SensitiveAction[];
  contains_sensitive: boolean;
  max_severity: "none" | "low" | "medium" | "high" | "critical";
  blocking: boolean; // true si au moins une action critical OU requires_lawyer
};

const SEVERITY_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

let CACHE: Array<{
  action_key: string;
  action_label: string;
  domain: string;
  severity: SensitiveAction["severity"];
  requires_human_validation: boolean;
  requires_lawyer: boolean;
  keywords: string[];
  legal_refs: Array<{ code?: string; source?: string }>;
}> | null = null;
let CACHE_AT = 0;
const CACHE_TTL = 5 * 60_000; // 5 min

async function loadCatalog() {
  if (CACHE && Date.now() - CACHE_AT < CACHE_TTL) return CACHE;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabaseAdmin
    .from("sensitive_actions_catalog")
    .select("action_key, action_label, domain, severity, requires_human_validation, requires_lawyer, keywords, legal_refs");
  CACHE = (data ?? []) as typeof CACHE;
  CACHE_AT = Date.now();
  return CACHE!;
}

function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export async function detectSensitiveActions(
  steps: WorkflowStepLike[],
): Promise<SensitiveDetectionResult> {
  const catalog = await loadCatalog();
  const detectedMap = new Map<string, SensitiveAction>();

  steps.forEach((step, idx) => {
    const fields: Array<{ field: SensitiveAction["matched_in"][number]["field"]; value: string }> = [
      { field: "title", value: normalize(step.title) },
      { field: "description", value: normalize(step.description) },
      { field: "template_slug", value: normalize(step.template_slug) },
      { field: "kind", value: normalize(step.kind) },
    ];

    for (const entry of catalog) {
      for (const kw of entry.keywords) {
        const nk = normalize(kw);
        if (!nk) continue;
        for (const f of fields) {
          if (f.value && f.value.includes(nk)) {
            const existing = detectedMap.get(entry.action_key);
            const match = {
              step_index: idx,
              step_key: step.key ?? `step_${idx}`,
              field: f.field,
              matched_keyword: kw,
            };
            if (existing) {
              existing.matched_in.push(match);
            } else {
              detectedMap.set(entry.action_key, {
                action_key: entry.action_key,
                action_label: entry.action_label,
                domain: entry.domain,
                severity: entry.severity,
                requires_human_validation: entry.requires_human_validation,
                requires_lawyer: entry.requires_lawyer,
                matched_in: [match],
                legal_refs: entry.legal_refs ?? [],
              });
            }
            break; // un seul matched_keyword par couple (entry, field)
          }
        }
      }
    }
  });

  const detected = Array.from(detectedMap.values());
  let max: SensitiveDetectionResult["max_severity"] = "none";
  for (const d of detected) {
    if (SEVERITY_RANK[d.severity] > SEVERITY_RANK[max]) max = d.severity;
  }
  const blocking = detected.some((d) => d.severity === "critical" || d.requires_lawyer);

  return {
    detected,
    contains_sensitive: detected.length > 0,
    max_severity: max,
    blocking,
  };
}
