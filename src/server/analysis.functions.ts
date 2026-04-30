import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as unknown as {
  from: (table: string) => any;
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_TEXT_CHARS = 60_000; // ~15-20 pages, on tronque pour l'IA

import { getTenantId } from "@/server/_shared/tenant.server";

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

type AnalysisResult = {
  document_type: string;
  summary: string;
  key_points: string[];
  risks: Array<{ severity: "low" | "medium" | "high"; title: string; description: string }>;
  compliance: Array<{ status: "ok" | "warning" | "issue"; title: string; description: string }>;
  recommendations: string[];
};

const SYSTEM_PROMPT = `Tu es un juriste expert en droit du travail français. Analyse le document juridique fourni (contrat, avenant, lettre RH, etc.) et retourne UNIQUEMENT un JSON valide selon ce schéma exact :

{
  "document_type": "string (ex: 'Contrat de travail CDI', 'Lettre de licenciement', 'Avenant', 'Rupture conventionnelle')",
  "summary": "string (résumé en 2-3 phrases)",
  "key_points": ["string", ...] (5-8 points clés du document),
  "risks": [
    { "severity": "low|medium|high", "title": "string", "description": "string (1-2 phrases)" }
  ],
  "compliance": [
    { "status": "ok|warning|issue", "title": "string (ex: Période d'essai, Clause de non-concurrence)", "description": "string" }
  ],
  "recommendations": ["string", ...] (3-5 actions recommandées)
}

Sois précis, cite les articles du Code du travail si pertinent. Réponds UNIQUEMENT avec le JSON, sans markdown ni texte additionnel.`;

async function callLovableAI(text: string): Promise<{ analysis: AnalysisResult; tokens: number }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY manquante");

  const truncated = text.length > MAX_TEXT_CHARS
    ? text.slice(0, MAX_TEXT_CHARS) + "\n\n[...document tronqué...]"
    : text;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Analyse ce document juridique :\n\n${truncated}` },
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

      // 3. Sauvegarde
      await db
        .from("document_analyses")
        .update({
          extracted_text: text.slice(0, MAX_TEXT_CHARS),
          analysis,
          tokens_used: tokens,
          status: "completed",
        })
        .eq("id", record.id);

      // Log usage
      await db.from("usage_logs").insert({
        tenant_id: tenantId,
        user_id: ctx.userId,
        action: "document_analysis",
        tokens_used: tokens,
        metadata: { filename: data.filename, file_type: data.file_type },
      });

      return { id: record.id as string, analysis, tokens };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      await db
        .from("document_analyses")
        .update({ status: "failed", error_message: msg })
        .eq("id", record.id);
      throw new Error(msg);
    }
  });

export const listAnalyses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);
    const { data, error } = await db
      .from("document_analyses")
      .select("id, filename, file_type, file_size, status, error_message, created_at, dossier_id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { analyses: data ?? [] };
  });

export const getAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as { userId: string };
    const tenantId = await getTenantId(ctx.userId);
    const { data: row, error } = await db
      .from("document_analyses")
      .select("*")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Analyse introuvable");
    return { analysis: row };
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
