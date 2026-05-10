import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";
import { logTimelineEvent } from "@/server/_shared/timeline.server";
import { enforceRateLimit } from "@/server/_shared/rate-limit.server";
import { sanitizePromptInput, PROMPT_INJECTION_GUARD } from "@/server/_shared/prompt-sanitizer.server";
import { captureServerError } from "@/server/_shared/error-monitor.server";
import {
  CONTRACT_RISKS,
  CONTRACT_RISK_KEYS,
  isValidIsoDate,
  type ContractRiskKey,
  type DetectedDate,
} from "@/lib/analysis/contract-risks";

const db = supabaseAdmin as unknown as {
  from: (table: string) => any;
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_TEXT_CHARS = 60_000; // ~15-20 pages, on tronque pour l'IA


// ─── Schemas ────────────────────────────────────────────────────────────────

const analyzeSchema = z.object({
  filename: z.string().min(1).max(255),
  file_type: z.enum(["pdf", "docx"]),
  file_base64: z.string().min(1),
  dossier_id: z.string().uuid().optional(),
});

const idSchema = z.object({ id: z.string().uuid() });

// ─── Extraction texte ───────────────────────────────────────────────────────

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const result = await extractText(pdf, { mergePages: true });
  const text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  return (text ?? "").trim();
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  // mammoth attend un Buffer ou un ArrayBuffer
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = await mammoth.extractRawText({ arrayBuffer: ab as ArrayBuffer });
  return (result.value ?? "").trim();
}

function decodeBase64(b64: string): Uint8Array {
  // strip data URL prefix si présent
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Appel IA ───────────────────────────────────────────────────────────────

type ExtractedField = {
  key: string;
  label: string;
  value: string | null;
  type?: "text" | "date" | "number" | "money" | "duration";
  confidence?: number;
  page?: number;
  excerpt?: string;
};

type AnalysisResult = {
  domain: "rh" | "commercial" | "societes" | "rgpd" | "fiscal" | "contentieux" | "administratif" | "autre";
  document_type: string;
  summary: string;
  extracted_fields: ExtractedField[];
  key_points: string[];
  risks: Array<{
    severity: "low" | "medium" | "high" | "critical";
    category?: string;
    risk_key?: ContractRiskKey | null;
    title: string;
    description: string;
    legal_basis?: Array<{ label: string; reference?: string }>;
    mitigation?: string;
  }>;
  compliance: Array<{ status: "ok" | "warning" | "issue"; title: string; description: string }>;
  recommendations: string[];
  contract_data?: {
    parties?: Array<{ role?: string; name?: string; legal_form?: string; siret?: string }>;
    object?: string;
    signature_date?: string;
    effective_date?: string;
    end_date?: string;
    duration?: string;
    renewal?: { type?: "tacite" | "expresse" | "aucune"; notice_days?: number; notice_deadline?: string };
    notice_period?: string;
    amount?: string;
    payment_terms?: string;
    penalties?: string;
    termination?: string;
    jurisdiction?: string;
    governing_law?: string;
    confidentiality?: boolean;
    non_compete?: { present?: boolean; duration?: string; zone?: string; compensation?: string };
  };
  detected_dates?: DetectedDate[];
};

const RISK_KEYS_LIST = CONTRACT_RISK_KEYS.join("|");

const SYSTEM_PROMPT = `Tu es un juriste français pluridisciplinaire (RH, commercial, sociétés, RGPD, fiscal, contentieux, administratif).
Analyse le document fourni et retourne UNIQUEMENT un JSON valide selon ce schéma :

{
  "domain": "rh|commercial|societes|rgpd|fiscal|contentieux|administratif|autre",
  "document_type": "string court (ex: 'CDI', 'CGV', 'PV d AG', 'Mise en demeure', 'DPA RGPD', 'Assignation TJ')",
  "summary": "résumé en 2-3 phrases",
  "extracted_fields": [
    { "key": "snake_case", "label": "libellé humain", "value": "valeur extraite", "type": "text|date|number|money|duration", "confidence": 0.0-1.0, "excerpt": "extrait textuel court" }
  ],
  "key_points": ["8 points clés maximum"],
  "contract_data": {
    "parties": [{"role":"client|fournisseur|employeur|salarié|bailleur|locataire|...","name":"...","legal_form":"SAS|SARL|...","siret":"..."}],
    "object": "objet du contrat en 1 phrase",
    "signature_date": "YYYY-MM-DD",
    "effective_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "duration": "ex: 12 mois, 3 ans, indéterminée",
    "renewal": {"type":"tacite|expresse|aucune","notice_days":90,"notice_deadline":"YYYY-MM-DD"},
    "notice_period": "ex: 3 mois",
    "amount": "ex: 1500 € HT/mois",
    "payment_terms": "ex: 30 jours fin de mois",
    "penalties": "description des pénalités",
    "termination": "modalités de résiliation",
    "jurisdiction": "ex: TJ de Paris",
    "governing_law": "ex: droit français",
    "confidentiality": true,
    "non_compete": {"present":true,"duration":"2 ans","zone":"France","compensation":"30% du salaire"}
  },
  "detected_dates": [
    { "key": "end_date", "label": "Fin du contrat", "iso_date": "YYYY-MM-DD", "type": "signature|effective|trial_end|renewal|notice|end|payment|deadline|other", "importance": "low|medium|high|critical", "description": "...", "excerpt": "..." }
  ],
  "risks": [
    { "severity": "low|medium|high|critical", "category": "clause|delai|conformite|financier|reputationnel|renouvellement|juridiction|rh", "risk_key": "${RISK_KEYS_LIST}|null", "title": "string", "description": "1-2 phrases", "legal_basis": [{"label":"...","reference":"..."}], "mitigation": "action recommandée" }
  ],
  "compliance": [
    { "status": "ok|warning|issue", "title": "ex: Période d essai / Clause RGPD / Délai de paiement", "description": "string" }
  ],
  "recommendations": ["3-6 actions priorisées"]
}

Règles :
- Identifie d'abord le domaine et le type de document.
- Extrait au moins 5 champs structurés clés (parties, dates, montants, durées, clauses notables).
- Pour les contrats, remplis "contract_data" le plus précisément possible. Toutes les dates doivent être au format ISO YYYY-MM-DD.
- Évalue les 13 risques contractuels typés et utilise "risk_key" parmi : ${RISK_KEYS_LIST}. Mets "risk_key": null pour un risque hors catalogue.
- Liste dans "detected_dates" toutes les dates importantes (signature, effet, fin, fin période d'essai, préavis à respecter, échéance de paiement, audience…).
- Cite les articles précis (Code du travail, Code civil, Code de commerce, RGPD, LPF, CPC, etc.).
- Réponds UNIQUEMENT avec le JSON, sans markdown ni texte additionnel.`;

async function callLovableAI(text: string): Promise<{ analysis: AnalysisResult; tokens: number }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY manquante");

  const safeUserBlock = sanitizePromptInput(text, { maxLength: MAX_TEXT_CHARS, label: "DOCUMENT" });

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      // Décision sensible (détection de risques juridiques) → Pro obligatoire
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${PROMPT_INJECTION_GUARD.replace(/USER_INPUT/g, "DOCUMENT")}` },
        { role: "user", content: `Analyse ce document juridique :\n\n${safeUserBlock}` },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429) throw new Error("Quota IA atteint, réessayez dans quelques instants.");
    if (response.status === 402) throw new Error("Crédits IA épuisés. Rechargez votre workspace.");
    throw new Error(`Erreur IA (${response.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens?: number };
  };

  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: AnalysisResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Réponse IA invalide (JSON malformé)");
  }

  // Defaults défensifs
  parsed.domain = (parsed.domain ?? "autre") as AnalysisResult["domain"];
  parsed.extracted_fields = Array.isArray(parsed.extracted_fields) ? parsed.extracted_fields : [];
  parsed.risks = Array.isArray(parsed.risks) ? parsed.risks : [];
  parsed.compliance = Array.isArray(parsed.compliance) ? parsed.compliance : [];
  parsed.recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  parsed.key_points = Array.isArray(parsed.key_points) ? parsed.key_points : [];
  parsed.contract_data = (parsed.contract_data && typeof parsed.contract_data === "object")
    ? parsed.contract_data
    : {};
  parsed.detected_dates = (Array.isArray(parsed.detected_dates) ? parsed.detected_dates : [])
    .filter((d) => d && isValidIsoDate((d as DetectedDate).iso_date));

  // Normalise risk_key : null si hors catalogue
  parsed.risks = parsed.risks.map((r) => ({
    ...r,
    risk_key: r.risk_key && CONTRACT_RISKS[r.risk_key as ContractRiskKey] ? r.risk_key : null,
  }));

  return {
    analysis: parsed,
    tokens: data.usage?.total_tokens ?? 0,
  };
}

// ─── Server Functions ───────────────────────────────────────────────────────

export const analyzeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => analyzeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);
    await enforceRateLimit(ctx.userId, "analysis.analyze", 10);

    // Vérifie la taille AVANT décodage (un base64 de 50MB bloque l'event loop).
    // base64 ≈ 4/3 du binaire → byte_size ≈ length * 0.75
    const estimatedBytes = Math.floor(data.file_base64.length * 0.75);
    if (estimatedBytes > MAX_FILE_SIZE) {
      throw new Error(`Fichier trop volumineux (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
    }
    const bytes = decodeBase64(data.file_base64);
    if (bytes.byteLength > MAX_FILE_SIZE) {
      throw new Error(`Fichier trop volumineux (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
    }

    // Crée l'enregistrement pending
    const { data: record, error: insertErr } = await db
      .from("document_analyses")
      .insert({
        tenant_id: tenantId,
        user_id: ctx.userId,
        filename: data.filename,
        file_type: data.file_type,
        file_size: bytes.byteLength,
        status: "pending",
        dossier_id: data.dossier_id ?? null,
      })
      .select("*")
      .single();
    if (insertErr) throw new Error(insertErr.message);

    try {
      // 1. Extraction texte
      const text =
        data.file_type === "pdf" ? await extractPdf(bytes) : await extractDocx(bytes);

      if (!text || text.length < 50) {
        throw new Error(
          "Aucun texte détecté. Ce document est peut-être scanné (image). L'OCR n'est pas encore supporté.",
        );
      }

      // 2. Analyse IA
      const { analysis, tokens } = await callLovableAI(text);

      // 3. Sauvegarde de l'analyse
      await db
        .from("document_analyses")
        .update({
          extracted_text: text.slice(0, MAX_TEXT_CHARS),
          analysis,
          contract_data: analysis.contract_data ?? {},
          detected_dates: analysis.detected_dates ?? [],
          tokens_used: tokens,
          status: "completed",
        })
        .eq("id", record.id);

      // 4. Persiste les champs structurés extraits
      if (analysis.extracted_fields.length > 0) {
        const rows = analysis.extracted_fields.map((f) => ({
          tenant_id: tenantId,
          document_analysis_id: record.id,
          field_key: f.key,
          field_value: f.value ?? null,
          field_type: f.type ?? "text",
          confidence: typeof f.confidence === "number" ? f.confidence : null,
          page_number: typeof f.page === "number" ? f.page : null,
          source_excerpt: f.excerpt ? `${f.label}: ${f.excerpt}` : f.label,
          validated_by_user: false,
        }));
        await db.from("extracted_fields").insert(rows);
      }

      // 5. Si rattaché à un dossier : crée les risques + deadlines + log timeline
      let createdDeadlines = 0;
      if (data.dossier_id) {
        // Crée les risques détectés (medium ou plus)
        const significantRisks = analysis.risks.filter(
          (r) => r.severity === "medium" || r.severity === "high" || r.severity === "critical",
        );
        if (significantRisks.length > 0) {
          const riskRows = significantRisks.map((r) => {
            const def = r.risk_key ? CONTRACT_RISKS[r.risk_key as ContractRiskKey] : null;
            return {
              tenant_id: tenantId,
              dossier_id: data.dossier_id,
              detected_by: ctx.userId,
              title: r.title,
              description: r.description,
              severity: r.severity,
              category: def?.category ?? r.category ?? "general",
              legal_basis: [
                ...(r.legal_basis ?? []),
                ...(r.risk_key ? [{ label: `risk_key:${r.risk_key}` }] : []),
              ],
              mitigation: r.mitigation ?? null,
              status: "open",
            };
          });
          await db.from("identified_risks").insert(riskRows);
        }

        // Crée les deadlines à partir des dates détectées (importance >= medium)
        const dates = (analysis.detected_dates ?? []).filter(
          (d) => d.importance === "medium" || d.importance === "high" || d.importance === "critical",
        );
        if (dates.length > 0) {
          const deadlineRows = dates.map((d) => ({
            tenant_id: tenantId,
            dossier_id: data.dossier_id,
            created_by: ctx.userId,
            title: d.label,
            description: d.description ?? d.excerpt ?? null,
            due_date: d.iso_date,
            completed: false,
            source: "analysis",
            source_analysis_id: record.id,
            deadline_type: d.type,
          }));
          const { error: dlErr } = await db.from("dossier_deadlines").insert(deadlineRows);
          if (!dlErr) createdDeadlines = dates.length;
        }

        await logTimelineEvent({
          tenantId,
          dossierId: data.dossier_id,
          actorId: ctx.userId,
          eventType: "analysis.completed",
          title: `Analyse : ${data.filename}`,
          description: `${analysis.document_type} (${analysis.domain}) — ${analysis.risks.length} risque(s), ${createdDeadlines} échéance(s) détectée(s)`,
          metadata: {
            analysis_id: record.id,
            file_type: data.file_type,
            domain: analysis.domain,
            document_type: analysis.document_type,
            risks_count: analysis.risks.length,
            deadlines_count: createdDeadlines,
            contract_data_present: Object.keys(analysis.contract_data ?? {}).length > 0,
            tokens,
          },
        });
      }

      // Log usage
      await db.from("usage_logs").insert({
        tenant_id: tenantId,
        user_id: ctx.userId,
        action: "document_analysis",
        tokens_used: tokens,
        metadata: { filename: data.filename, file_type: data.file_type, domain: analysis.domain },
      });

      // Pipeline post-ingestion (entités → contexte → liaisons → index → timeline)
      try {
        const { processUploadedDocument } = await import(
          "@/server/_shared/document-pipeline.server"
        );
        await processUploadedDocument({
          documentId: record.id,
          tenantId,
          actorId: ctx.userId,
          forcedDossierId: data.dossier_id ?? null,
        });
      } catch (e) {
        console.error("[analysis] pipeline failed", e);
      }

      return { id: record.id as string, analysis, tokens };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      await db
        .from("document_analyses")
        .update({ status: "failed", error_message: msg })
        .eq("id", record.id);
      await captureServerError("analysis.analyzeDocument", { userId: ctx.userId, tenantId, extra: { analysisId: record.id, filename: data.filename } }, err);
      throw new Error(msg);
    }
  });

const listAnalysesSchema = z
  .object({ limit: z.number().min(1).max(100).optional(), offset: z.number().min(0).optional() })
  .optional();

export const listAnalyses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listAnalysesSchema.parse(input ?? {}) ?? {})
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);
    const limit = data?.limit ?? 30;
    const offset = data?.offset ?? 0;
    const { data: rows, error, count } = await db
      .from("document_analyses")
      .select("id, filename, file_type, file_size, status, error_message, created_at, dossier_id", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { analyses: rows ?? [], total: count ?? 0, hasMore: (rows?.length ?? 0) === limit };
  });

export const getAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);

    const [{ data: row, error }, { data: fields }] = await Promise.all([
      db
        .from("document_analyses")
        .select("*")
        .eq("id", data.id)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      db
        .from("extracted_fields")
        .select("*")
        .eq("document_analysis_id", data.id)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true }),
    ]);
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Analyse introuvable");
    return { analysis: row, extracted_fields: fields ?? [] };
  });

export const validateExtractedField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      field_value: z.string().nullable().optional(),
      validated: z.boolean().default(true),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);
    const update: Record<string, unknown> = { validated_by_user: data.validated };
    if (data.field_value !== undefined) update.field_value = data.field_value;
    const { error } = await db
      .from("extracted_fields")
      .update(update)
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);
    const { error } = await db
      .from("document_analyses")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
