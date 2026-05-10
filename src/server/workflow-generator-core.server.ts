// Helper interne réutilisable (utilisé par le serverFn ET par agent-tools).
// Isolé dans un fichier *.server.ts pour empêcher toute fuite côté client
// via le splitter Vite (les .functions.ts ne doivent contenir QUE des
// createServerFn pour que le splitter strippe les imports serveurs).

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "./_shared/tenant.server";
import { searchLegalSources } from "./_shared/legal-rag.server";
import { multiQueryRag } from "./_shared/multi-query-rag.server";
import { embedText, toPgVector } from "./_shared/embeddings.server";
import {
  validateWorkflowDraft,
  type WorkflowDraft,
  type WorkflowQualityReport,
} from "./_shared/workflow-validators.server";
import { logWorkflowAudit } from "./_shared/workflow-audit.server";

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1";
const GEN_MODEL = "google/gemini-2.5-pro";
const CACHE_THRESHOLD = 0.85;

const GEN_SYSTEM = `Tu es un expert juridique français. Tu génères un workflow procédural complet à partir d'une demande utilisateur.

OBLIGATIONS :
- Logique 8 phases : Comprendre → Sourcer → Proposer → Préparer → Valider → Exécuter → Archiver → Suivre.
- Chaque étape sensible doit citer ses bases légales (articles, codes).
- Pour toute décision sensible (sanction, licenciement, transaction, contentieux, dépôt légal, RGPD majeur, fiscal contentieux) : ajoute une étape de validation humaine AVANT exécution.
- Délais légaux : indique delay_days quand applicable.
- Templates : utilise template_slug uniquement si tu en connais un (sinon laisse vide).

Retourne STRICTEMENT un JSON :
{
  "title": "...",
  "description": "...",
  "category": "rh|commercial|societes|rgpd|fiscal|contentieux|administratif|contrats|reglementation|autre",
  "estimated_duration_days": 0,
  "legal_refs": [{"code":"L1232-1","source":"Code du travail"}],
  "steps": [
    {
      "key": "preparation",
      "title": "Préparer le dossier",
      "description": "...",
      "kind": "action|document|decision|wait|validation",
      "template_slug": null,
      "legal_refs": ["L1232-1"],
      "requires_sourcing": true,
      "delay_days": 0
    }
  ]
}
Aucun texte hors JSON.`;

export const GenerateInput = z.object({
  prompt: z.string().trim().min(10).max(2000),
  domain: z.string().optional(),
  category: z.string().optional(),
  dryRun: z.boolean().optional(),
});

// BUG-W5 : schéma Zod du draft IA pour valider avant insertion en base.
const WorkflowDraftSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  category: z.string().min(1),
  estimated_duration_days: z.number().int().nonnegative().optional(),
  legal_refs: z.array(z.object({
    code: z.string().optional(),
    source: z.string().optional(),
    reference: z.string().optional(),
  })).optional(),
  steps: z.array(z.object({
    key: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    kind: z.string().optional(),
    type: z.string().optional(),
    template_slug: z.string().nullable().optional(),
    legal_refs: z.array(z.string()).optional(),
    requires_sourcing: z.boolean().optional(),
    delay_days: z.number().int().nonnegative().optional(),
  })).min(1),
});

export type GenerateWorkflowResult = {
  run_id: string;
  cache_hit: boolean;
  workflow_definition_id: string | null;
  draft: WorkflowDraft | null;
  quality: WorkflowQualityReport | null;
  duplicate_of: { id: string; title: string; similarity: number } | null;
  error?: string;
};

export async function runGenerateWorkflow(
  data: z.infer<typeof GenerateInput>,
  userId: string,
): Promise<GenerateWorkflowResult> {
  const tenantId = await getTenantId(userId);
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY manquant côté serveur");

  const startedAt = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;

  const { data: runRow, error: runErr } = await sb
    .from("workflow_generation_runs")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      prompt: data.prompt,
      domain: data.domain ?? null,
      category: data.category ?? null,
      llm_model: GEN_MODEL,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr || !runRow) throw new Error(runErr?.message ?? "Création run échouée");
  const runId = runRow.id as string;

  try {
    const embedding = await embedText(data.prompt);
    let cacheHit: GenerateWorkflowResult["duplicate_of"] = null;

    if (embedding) {
      const { data: similar } = await sb.rpc("match_workflow_definitions", {
        query_embedding: embedding,
        match_threshold: CACHE_THRESHOLD,
        match_count: 1,
        tenant_id_filter: tenantId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }).then((r: any) => r).catch(() => ({ data: null }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let candidate: any = null;
      if (Array.isArray(similar) && similar.length > 0) {
        candidate = similar[0];
      } else {
        const { data: rows } = await sb
          .from("workflow_definitions")
          .select("id, title, lifecycle_status, topic_embedding")
          .eq("lifecycle_status", "human_validated")
          .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
          .not("topic_embedding", "is", null)
          .limit(50);
        if (Array.isArray(rows) && rows.length > 0) {
          let best: { id: string; title: string; sim: number } | null = null;
          for (const r of rows) {
            if (!Array.isArray(r.topic_embedding)) continue;
            const sim = cosine(embedding, r.topic_embedding as number[]);
            if (!best || sim > best.sim) best = { id: r.id, title: r.title, sim };
          }
          if (best && best.sim >= CACHE_THRESHOLD) {
            candidate = { id: best.id, title: best.title, similarity: best.sim };
          }
        }
      }

      if (candidate?.id) {
        cacheHit = {
          id: candidate.id,
          title: candidate.title,
          similarity: Number(candidate.similarity ?? candidate.sim ?? 1),
        };
      }
    }

    if (cacheHit) {
      await sb.from("workflow_generation_runs").update({
        status: "succeeded",
        cache_hit: true,
        duplicate_of_definition_id: cacheHit.id,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
      }).eq("id", runId);

      await logWorkflowAudit({
        tenantId, userId,
        workflowDefinitionId: cacheHit.id,
        action: "workflow.cache_hit",
        metadata: { run_id: runId, similarity: cacheHit.similarity, prompt: data.prompt.slice(0, 200) },
      });

      return {
        run_id: runId,
        cache_hit: true,
        workflow_definition_id: cacheHit.id,
        draft: null,
        quality: null,
        duplicate_of: cacheHit,
      };
    }

    const idccEarly = await fetchTenantIdcc(tenantId);
    const mqRag = await multiQueryRag(data.prompt, { idcc: idccEarly, apiKey, topN: 18 });
    let ragSources = mqRag.sources;
    if (ragSources.length === 0) {
      const fallback = await searchLegalSources(data.prompt, { idcc: idccEarly, limit: 6 });
      if (fallback.ok) {
        ragSources = fallback.sources.map((s) => ({
          source_id: String(s.n),
          chunk_id: String(s.n),
          title: s.title,
          reference: s.reference ?? null,
          url: s.url ?? null,
          source_type: "autre",
          excerpt: s.excerpt,
          authority: 50,
        }));
      }
    }
    const ragBlock = ragSources.length
      ? ragSources
          .slice(0, 12)
          .map(
            (s, i) =>
              `[source:${i + 1}] ${s.title}${s.reference ? ` (${s.reference})` : ""} — ${s.excerpt.slice(0, 400)}`,
          )
          .join("\n")
      : "(Aucune source RAG pertinente trouvée — génère prudemment et marque requires_sourcing=true partout.)";

    const userPrompt = `Demande :\n${data.prompt}\n\nContexte légal RAG (à utiliser comme appui) :\n${ragBlock}`;

    const t0 = Date.now();
    const genRes = await fetch(`${AI_GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GEN_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: GEN_SYSTEM },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!genRes.ok) {
      const txt = await genRes.text();
      throw new Error(`IA génération ${genRes.status} : ${txt.slice(0, 200)}`);
    }
    const genJson = await genRes.json();
    const tokensUsed = genJson.usage?.total_tokens ?? null;
    const rawContent = genJson.choices?.[0]?.message?.content ?? "{}";
    let draft: WorkflowDraft;
    try {
      // BUG-W5 : on valide le draft avec Zod avant d'insérer en base, sinon
      // une réponse IA mal formée crée des steps cassés.
      const parsed = JSON.parse(rawContent);
      draft = WorkflowDraftSchema.parse(parsed) as WorkflowDraft;
    } catch (e) {
      throw new Error(`Draft IA invalide : ${(e as Error).message}`);
    }
    if (!Array.isArray(draft.steps) || draft.steps.length === 0) {
      throw new Error("Draft invalide (steps manquants).");
    }
    const genDuration = Date.now() - t0;

    const quality = await validateWorkflowDraft(draft, { tenantId, idcc: idccEarly, apiKey });

    if (data.dryRun) {
      await sb.from("workflow_generation_runs").update({
        status: "succeeded",
        tokens_used: tokensUsed,
        duration_ms: Date.now() - startedAt,
        completed_at: new Date().toISOString(),
        sources_used: ragSources,
        scores: quality.scores,
      }).eq("id", runId);
      await persistQualityChecks(runId, null, quality);
      return {
        run_id: runId,
        cache_hit: false,
        workflow_definition_id: null,
        draft,
        quality,
        duplicate_of: null,
      };
    }

    const baseSlug = slugify(draft.title);
    const slug = `${baseSlug}-${runId.slice(0, 8)}`;

    const { data: defRow, error: defErr } = await sb
      .from("workflow_definitions")
      .insert({
        tenant_id: tenantId,
        slug,
        title: draft.title.slice(0, 200),
        description: draft.description ?? null,
        category: draft.category ?? "autre",
        steps: draft.steps,
        legal_refs: draft.legal_refs ?? [],
        estimated_duration_days: draft.estimated_duration_days ?? null,
        status: "draft",
        lifecycle_status: quality.auto_status,
        score_legal_refs: quality.scores.legal_refs,
        score_logic: quality.scores.logic,
        score_documents: quality.scores.documents,
        score_completeness: quality.scores.completeness,
        score_safety: quality.scores.safety,
        score_overall: quality.scores.overall,
        generated_by_ai: true,
        generation_run_id: runId,
        topic_embedding: embedding ? toPgVector(embedding) : null,
        requires_human_review: quality.auto_status !== "ai_validated_auto",
        contains_sensitive_actions: quality.sensitive.contains_sensitive,
        sensitive_actions_detected: quality.sensitive.detected,
        llm_model: GEN_MODEL,
        source_chunk_ids: ragSources.map((s) => s.chunk_id),
        requires_sourcing: true,
      })
      .select("id")
      .single();
    if (defErr || !defRow) throw new Error(defErr?.message ?? "Insertion workflow échouée");
    const definitionId = defRow.id as string;

    await sb.from("workflow_generation_runs").update({
      status: "succeeded",
      generated_definition_id: definitionId,
      tokens_used: tokensUsed,
      duration_ms: Date.now() - startedAt,
      completed_at: new Date().toISOString(),
      sources_used: ragSources,
      scores: quality.scores,
    }).eq("id", runId);

    await persistQualityChecks(runId, definitionId, quality);

    await logWorkflowAudit({
      tenantId, userId,
      workflowDefinitionId: definitionId,
      action: "workflow.generated",
      afterState: { lifecycle_status: quality.auto_status, scores: quality.scores },
      metadata: {
        run_id: runId,
        gen_duration_ms: genDuration,
        tokens_used: tokensUsed,
        sensitive_count: quality.sensitive.detected.length,
        max_severity: quality.sensitive.max_severity,
      },
    });
    if (quality.auto_status === "ai_validated_auto") {
      await logWorkflowAudit({
        tenantId, userId, workflowDefinitionId: definitionId,
        action: "workflow.auto_validated",
        metadata: { scores: quality.scores },
      });
    } else {
      await logWorkflowAudit({
        tenantId, userId, workflowDefinitionId: definitionId,
        action: "workflow.pending_review",
        metadata: { scores: quality.scores, reasons: quality.reasons },
      });
    }

    return {
      run_id: runId,
      cache_hit: false,
      workflow_definition_id: definitionId,
      draft,
      quality,
      duplicate_of: null,
    };
  } catch (e) {
    const message = (e as Error).message;
    await sb.from("workflow_generation_runs").update({
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    }).eq("id", runId);
    return {
      run_id: runId,
      cache_hit: false,
      workflow_definition_id: null,
      draft: null,
      quality: null,
      duplicate_of: null,
      error: message,
    };
  }
}

async function fetchTenantIdcc(tenantId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabaseAdmin as any)
    .from("tenants").select("idcc").eq("id", tenantId).maybeSingle();
  return (data as { idcc: string | null } | null)?.idcc ?? null;
}

async function persistQualityChecks(
  runId: string,
  definitionId: string | null,
  quality: WorkflowQualityReport,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  const rows = [
    { check_type: "legal_refs",   score: quality.scores.legal_refs,   passed: quality.scores.legal_refs   >= 70, details: quality.rerag },
    { check_type: "logic",        score: quality.scores.logic,        passed: quality.scores.logic        >= 70, details: quality.consensus },
    { check_type: "documents",    score: quality.scores.documents,    passed: quality.scores.documents    >= 60, details: quality.documents },
    { check_type: "completeness", score: quality.scores.completeness, passed: quality.scores.completeness >= 70, details: { score: quality.scores.completeness } },
    { check_type: "safety",       score: quality.scores.safety,       passed: quality.scores.safety       >= 80, details: quality.sensitive },
    { check_type: "rerag",        score: quality.scores.legal_refs,   passed: quality.rerag.failures.length === 0, details: quality.rerag },
    { check_type: "consensus",    score: quality.scores.logic,        passed: quality.consensus.disagreement <= 30, details: quality.consensus },
  ].map((r) => ({ ...r, generation_run_id: runId, workflow_definition_id: definitionId }));
  await sb.from("workflow_quality_checks").insert(rows);
}

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "workflow";
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
