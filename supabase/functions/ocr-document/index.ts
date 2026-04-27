// Edge function: ocr-document
// Input: { storage_path, dossier_id?, filename, file_type }
// 1. Download file from dossier-files bucket via signed URL (service role)
// 2. Send to Lovable AI gateway with vision model for OCR + summary
// 3. Persist result in document_analyses
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VISION_MODEL = "google/gemini-3-flash-preview";

const OCR_PROMPT = `Tu es un OCR juridique. Pour ce document :
1. **Transcris fidèlement** tout le texte visible (titres, paragraphes, signatures, dates).
2. Termine par une section **"## Résumé"** de 3-5 lignes en français.
3. Termine par **"## Type de document détecté"** : contrat, lettre, jugement, avenant, etc.
Format Markdown propre, pas de commentaire superflu.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonErr("Missing env", 500);
    }

    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing authorization", 401);
    const accessToken = auth.replace(/^Bearer\s+/i, "");

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(accessToken);
    if (userErr || !userData.user) return jsonErr("Invalid session", 401);
    const userId = userData.user.id;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile } = await supabase
      .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
    const tenantId = (profile as { tenant_id: string | null } | null)?.tenant_id;
    if (!tenantId) return jsonErr("No tenant", 403);

    const body = await req.json();
    const storage_path: string = String(body.storage_path ?? "");
    const filename: string = String(body.filename ?? "document");
    const file_type: string = String(body.file_type ?? "application/octet-stream");
    const dossier_id: string | null = body.dossier_id ? String(body.dossier_id) : null;

    if (!storage_path.startsWith(`${tenantId}/`)) {
      return jsonErr("Forbidden — path outside tenant", 403);
    }

    // Rate limit
    const { data: rl } = await supabase.rpc("check_rate_limit", {
      p_user_id: userId, p_endpoint: "ocr-document", p_max_per_minute: 5,
    });
    if (Array.isArray(rl) && rl[0] && !rl[0].allowed) {
      return jsonErr("Trop de requêtes (5/min)", 429);
    }

    // Download file
    const { data: file, error: dlErr } = await supabase.storage
      .from("dossier-files").download(storage_path);
    if (dlErr || !file) return jsonErr("File not found in storage", 404);

    const buf = await file.arrayBuffer();
    if (buf.byteLength > 15 * 1024 * 1024) {
      return jsonErr("Fichier trop volumineux (max 15 Mo pour OCR)", 413);
    }
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const mediaType = file_type;

    // Create pending analysis row
    const { data: row } = await supabase
      .from("document_analyses").insert({
        tenant_id: tenantId,
        user_id: userId,
        dossier_id,
        filename,
        file_type: mediaType,
        file_size: buf.byteLength,
        status: "processing",
        storage_path,
      }).select("id").single();
    const analysisId = (row as { id: string } | null)?.id;

    // Call vision model
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: OCR_PROMPT },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
            ],
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("OCR AI error", aiRes.status, errText);
      if (analysisId) {
        await supabase.from("document_analyses").update({
          status: "failed",
          error_message: `AI gateway ${aiRes.status}`,
        }).eq("id", analysisId);
      }
      if (aiRes.status === 429) return jsonErr("Trop de requêtes IA", 429);
      if (aiRes.status === 402) return jsonErr("Crédits IA épuisés", 402);
      return jsonErr("OCR a échoué", 500);
    }

    const aiJson = await aiRes.json();
    const text: string = aiJson.choices?.[0]?.message?.content ?? "";

    // Persist
    if (analysisId) {
      await supabase.from("document_analyses").update({
        status: "completed",
        extracted_text: text,
        analysis: { ocr_model: VISION_MODEL, length: text.length },
      }).eq("id", analysisId);
    }

    // Audit
    await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      action: "ocr.document",
      resource_type: "document_analysis",
      resource_id: analysisId,
      metadata: { filename, file_type: mediaType, size: buf.byteLength },
    });

    return new Response(
      JSON.stringify({ id: analysisId, text, length: text.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ocr-document error:", e);
    return jsonErr(e instanceof Error ? e.message : "Unknown", 500);
  }
});

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
