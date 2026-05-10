// Pipeline de vérification post-réponse de l'agent JurisAI.
// Étapes : détecter la règle métier → vérifier complétude → décider validation humaine
// → journaliser dans agent_post_checks → enrichir agent_memory si pertinent.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pickBusinessRule, type BusinessRuleRow } from "./business-rules.server";
import { rememberMemory } from "./agent-memory.server";
import { logTimelineEvent } from "./timeline.server";

export type PostCheckInput = {
  tenantId: string;
  userId: string;
  agentRunId: string;
  dossierId?: string | null;
  message: string;
  answer: string;
  intent: string;
  domain: string;
  topic: string;
  trace: Array<{ tool: string; sensitive: boolean; validation_request_id: string | null }>;
  refused: boolean;
};

export type PostCheckOutput = {
  rule_kind: string | null;
  missing_information: string[];
  requires_validation: boolean;
  validation_roles: string[];
  status: "ok" | "needs_info" | "needs_validation" | "skipped";
};

export async function runPostResponsePipeline(
  input: PostCheckInput,
): Promise<PostCheckOutput> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;

  if (input.refused) {
    const out: PostCheckOutput = {
      rule_kind: null,
      missing_information: [],
      requires_validation: false,
      validation_roles: [],
      status: "skipped",
    };
    await sb.from("agent_post_checks").insert({
      tenant_id: input.tenantId,
      agent_run_id: input.agentRunId,
      rule_kind: null,
      missing_information: [],
      requires_validation: false,
      validation_roles: [],
      status: out.status,
      notes: "Réponse refusée : pipeline skip.",
    });
    return out;
  }

  const haystack = `${input.topic}\n${input.message}\n${input.answer}`;
  let rule: BusinessRuleRow | null = null;
  try {
    rule = await pickBusinessRule(haystack);
  } catch {
    rule = null;
  }

  // Détection des champs manquants : on cherche les labels/keys dans la réponse.
  const missing: string[] = [];
  if (rule && rule.required_fields.length > 0) {
    const lower = (input.answer + " " + input.message).toLowerCase();
    for (const f of rule.required_fields) {
      const hit = lower.includes(f.label.toLowerCase()) || lower.includes(f.key.toLowerCase());
      if (!hit) missing.push(f.label);
    }
  }

  // Validation humaine requise ?
  const traceForcedValidation = input.trace.some(
    (t) => t.sensitive && !t.validation_request_id,
  );
  const ruleSensitive = rule?.is_sensitive ?? false;
  const requiresValidation = ruleSensitive || traceForcedValidation;

  let status: PostCheckOutput["status"] = "ok";
  if (missing.length > 0) status = "needs_info";
  else if (requiresValidation) status = "needs_validation";

  await sb.from("agent_post_checks").insert({
    tenant_id: input.tenantId,
    agent_run_id: input.agentRunId,
    rule_kind: rule?.kind ?? null,
    missing_information: missing,
    requires_validation: requiresValidation,
    validation_roles: rule?.validation_roles ?? [],
    status,
    notes: rule ? `Règle détectée : ${rule.title}` : "Aucune règle métier détectée",
  });

  // Mémoire : on retient le sujet courant pour le dossier (relevance moyenne).
  if (input.dossierId && input.topic) {
    try {
      await rememberMemory({
        tenantId: input.tenantId,
        scope: "dossier",
        key: `last_topic`,
        value: { topic: input.topic, intent: input.intent, domain: input.domain, at: new Date().toISOString() },
        dossierId: input.dossierId,
        relevance: 0.6,
      });
    } catch {
      /* noop */
    }
  }

  // Timeline du dossier si applicable
  if (input.dossierId) {
    try {
      await logTimelineEvent({
        tenantId: input.tenantId,
        actorId: input.userId,
        dossierId: input.dossierId,
        eventType: "agent.post_check",
        title: rule
          ? `Vérification post-réponse — ${rule.title} (${status})`
          : `Vérification post-réponse (${status})`,
        metadata: {
          rule_kind: rule?.kind ?? null,
          missing_information: missing,
          requires_validation: requiresValidation,
          agent_run_id: input.agentRunId,
        },
      });
    } catch {
      /* noop */
    }
  }

  return {
    rule_kind: rule?.kind ?? null,
    missing_information: missing,
    requires_validation: requiresValidation,
    validation_roles: rule?.validation_roles ?? [],
    status,
  };
}
