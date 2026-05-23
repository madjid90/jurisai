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

  // Audit fix : créer automatiquement validation_requests si validation requise et pas déjà créée.
  // Avant ce fix : 0 row dans validation_requests malgré 14 runs sensibles
  // → le LLM n'appelait jamais request_validation lui-même.
  // Garde-fou algorithmique : on ne dépend plus de la bonne volonté du LLM.
  if (requiresValidation && status === "needs_validation") {
    try {
      const alreadyCreated = input.trace.some((t) => t.validation_request_id !== null);
      if (!alreadyCreated) {
        // assigned_to : on prend le 1er admin_tenant du tenant. Sinon le requested_by lui-même (escalade impossible mais tracé).
        const { data: tenantAdmin } = await sb
          .from("user_roles")
          .select("user_id")
          .eq("tenant_id", input.tenantId)
          .in("role", ["admin_tenant", "super_admin"])
          .limit(1)
          .maybeSingle();
        const assignedTo = (tenantAdmin as { user_id: string } | null)?.user_id ?? input.userId;

        await sb.from("validation_requests").insert({
          tenant_id: input.tenantId,
          requested_by: input.userId,
          assigned_to: assignedTo,
          subject_type: "agent_run",
          subject_id: input.agentRunId,
          dossier_id: input.dossierId,
          status: "pending",
          comment: `Validation auto-déclenchée : ${rule?.title ?? "réponse agent sensible"} (intent=${input.intent}, domain=${input.domain}). Le contenu n'a pas été soumis spontanément par l'agent.`,
        });
      }
    } catch (e) {
      console.error("[post-response] auto-create validation_request failed:", e);
    }
  }

  // Mémoire — 3 écritures parallèles pour que l'agent soit cohérent entre sessions :
  //
  // 1. scope=dossier  → dernier topic abordé sur ce dossier (relevance haute)
  // 2. scope=user     → liste rotative des derniers sujets / intents du user
  //                    (l'agent peut dire "comme on en parlait la dernière fois...")
  // 3. scope=tenant   → fréquences d'intents/domains pour calibrer les suggestions
  //
  // Aucune des 3 ne doit faire crasher la réponse — try/catch indépendants.
  const nowIso = new Date().toISOString();

  if (input.dossierId && input.topic) {
    try {
      await rememberMemory({
        tenantId: input.tenantId,
        scope: "dossier",
        key: "last_topic",
        value: { topic: input.topic, intent: input.intent, domain: input.domain, at: nowIso },
        dossierId: input.dossierId,
        relevance: 0.7,
      });
    } catch { /* noop */ }
  }

  if (input.userId && input.topic) {
    try {
      // Lecture-modification : on garde les 5 derniers sujets en file glissante.
      const { data: existing } = await sb
        .from("agent_memory")
        .select("value")
        .eq("tenant_id", input.tenantId)
        .eq("scope", "user")
        .eq("key", "recent_topics")
        .eq("user_id", input.userId)
        .maybeSingle();

      const prev = (existing?.value?.items as Array<{ topic: string; intent: string; domain: string; at: string }>) ?? [];
      const next = [
        { topic: input.topic, intent: input.intent, domain: input.domain, at: nowIso },
        ...prev.filter((p) => p.topic !== input.topic),
      ].slice(0, 5);

      await rememberMemory({
        tenantId: input.tenantId,
        scope: "user",
        key: "recent_topics",
        value: { items: next, count: next.length },
        userId: input.userId,
        relevance: 0.5,
      });
    } catch { /* noop */ }
  }

  if (input.intent && input.domain) {
    try {
      const { data: existing } = await sb
        .from("agent_memory")
        .select("value")
        .eq("tenant_id", input.tenantId)
        .eq("scope", "tenant")
        .eq("key", "intent_frequency")
        .maybeSingle();

      const counters = (existing?.value as Record<string, number> | null) ?? {};
      const k = `${input.intent}|${input.domain}`;
      counters[k] = (counters[k] ?? 0) + 1;

      await rememberMemory({
        tenantId: input.tenantId,
        scope: "tenant",
        key: "intent_frequency",
        value: counters,
        relevance: 0.4,
      });
    } catch { /* noop */ }
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
