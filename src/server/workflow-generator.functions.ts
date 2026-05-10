// Générateur de workflows par IA avec contrôle qualité 3 couches.
//
//  Pipeline :
//   1. Cache sémantique : si un workflow `human_validated` similaire existe
//      (cosine ≥ 0.85), on le renvoie directement (cache_hit).
//   2. Sinon : RAG juridique (searchLegalSources) → prompt structuré →
//      Gemini Pro retourne un draft JSON (steps + legal_refs + delays).
//   3. validateWorkflowDraft → 6 scores + détection sensibles + auto_status.
//   4. Persistance : workflow_definitions (lifecycle_status = auto_status,
//      generated_by_ai = true, scores, embedding) + workflow_generation_runs
//      + workflow_quality_checks (un par check).
//   5. Audit : workflow_audit_log (rétention 10 ans).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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

const GenerateInput = z.object({
  prompt: z.string().trim().min(10).max(2000),
  domain: z.string().optional(),
  category: z.string().optional(),
  /** Si true : ne pas écrire en base, juste retourner le draft + scores (mode preview admin). */
  dryRun: z.boolean().optional(),
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

// Helper interne réutilisable (utilisé par le serverFn ET par agent-tools)
// Contourne uniquement la couche HTTP/middleware, mais EXIGE userId déjà
// authentifié par l'appelant (l'agent passe par requireSupabaseAuth en amont).
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

    // 0. Pré-créer la run
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
      // 1. Embedding du prompt → cache sémantique
      const embedding = await embedText(data.prompt);
      let cacheHit: GenerateWorkflowResult["duplicate_of"] = null;

      if (embedding) {
        const { data: similar } = await sb.rpc("match_workflow_definitions", {
          query_embedding: embedding,
          match_threshold: CACHE_THRESHOLD,
          match_count: 1,
          tenant_id_filter: tenantId,
        }).then((r: any) => r).catch(() => ({ data: null }));

        // Fallback : si la RPC n'existe pas, on fait une requête directe
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
          // distance cosine côté JS (fallback simple si la RPC manque)
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

      // 2. Multi-Query RAG juridique pour ancrer la génération
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

      // 3. Génération LLM
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
        draft = JSON.parse(rawContent) as WorkflowDraft;
      } catch (e) {
        throw new Error(`Parsing JSON échoué : ${(e as Error).message}`);
      }
      if (!draft || !Array.isArray(draft.steps) || draft.steps.length === 0) {
        throw new Error("Draft invalide (steps manquants).");
      }
      const genDuration = Date.now() - t0;

      // 4. Validation 3 couches
      const quality = await validateWorkflowDraft(draft, { tenantId, idcc: idccEarly, apiKey });

      // 5. Persistance — si dryRun, on s'arrête là
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

      // Slug unique
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
          status: "draft",                 // ancien enum (compat)
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

// Wrapper HTTP : middleware + validation + délégation au helper interne.
export const generateWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GenerateInput.parse(i))
  .handler(async ({ data, context }): Promise<GenerateWorkflowResult> => {
    const { userId } = context as { userId: string };
    return runGenerateWorkflow(data, userId);
  });

// ─── Validation manuelle (admin) ───────────────────────────────────────────

export const setWorkflowLifecycleStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      definitionId: z.string().uuid(),
      status: z.enum(["human_validated", "rejected", "pending_human_review"]),
      reason: z.string().max(1000).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;

    // Vérification rôle admin (tenant ou super)
    const { data: roleCheck } = await sb.rpc("has_role", {
      _user_id: userId, _role: "admin", _tenant_id: tenantId,
    });
    const { data: superCheck } = await sb.rpc("is_super_admin", { _user_id: userId });
    if (!roleCheck && !superCheck) throw new Error("Réservé aux admins");

    const { data: before } = await sb
      .from("workflow_definitions")
      .select("id, lifecycle_status, tenant_id, title")
      .eq("id", data.definitionId)
      .maybeSingle();
    if (!before) throw new Error("Workflow introuvable");
    if (before.tenant_id && before.tenant_id !== tenantId && !superCheck) {
      throw new Error("Workflow d'un autre tenant");
    }

    const update: Record<string, unknown> = {
      lifecycle_status: data.status,
      validated_by: data.status === "human_validated" ? userId : null,
      validated_at: data.status === "human_validated" ? new Date().toISOString() : null,
      requires_human_review: data.status === "pending_human_review",
      rejected_reason: data.status === "rejected" ? (data.reason ?? null) : null,
    };
    const { error } = await sb.from("workflow_definitions").update(update).eq("id", data.definitionId);
    if (error) throw new Error(error.message);

    await logWorkflowAudit({
      tenantId,
      userId,
      workflowDefinitionId: data.definitionId,
      action:
        data.status === "human_validated" ? "workflow.human_validated" :
        data.status === "rejected"        ? "workflow.rejected" :
                                            "workflow.pending_review",
      beforeState: { lifecycle_status: before.lifecycle_status },
      afterState: { lifecycle_status: data.status },
      metadata: { reason: data.reason ?? null },
    });

    return { ok: true, lifecycle_status: data.status };
  });

// ─── Lectures (admin) ──────────────────────────────────────────────────────

export const listGenerationRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ limit: z.number().min(1).max(100).optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await (supabaseAdmin as any)
      .from("workflow_generation_runs")
      .select("id, prompt, domain, category, status, llm_model, cache_hit, tokens_used, duration_ms, scores, error_message, generated_definition_id, duplicate_of_definition_id, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 30);
    return (rows ?? []) as any[];
  });

export const getGenerationRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ runId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { data: run } = await sb
      .from("workflow_generation_runs")
      .select("*")
      .eq("id", data.runId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!run) throw new Error("Run introuvable");
    const { data: checks } = await sb
      .from("workflow_quality_checks")
      .select("*")
      .eq("generation_run_id", data.runId);
    const { data: definition } = run.generated_definition_id
      ? await sb.from("workflow_definitions").select("*").eq("id", run.generated_definition_id).maybeSingle()
      : { data: null };
    return { run, checks: checks ?? [], definition };
  });

// ─── Helpers internes ──────────────────────────────────────────────────────

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
