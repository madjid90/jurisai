// Edge function: ingest-legal-source
// Imports a legal source from a URL or raw text. Pipeline:
//   1. Auth check (super_admin only)
//   2. Create ingestion_job + legal_source rows
//   3. Fetch URL or use provided text
//   4. Strip HTML, chunk, embed
//   5. Insert legal_chunks
//   6. Update job status

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { embedTexts, chunkText } from "../_shared/embeddings.ts";
import { smartChunk } from "../_shared/smart-chunk.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      throw new Error("Missing env vars");
    }

    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = auth.replace(/^Bearer\s+/i, "");
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: u } = await userClient.auth.getUser(token);
    if (!u.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = u.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "super_admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: super_admin required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      title,
      source_type,
      reference_code,
      official_url,
      idcc,
      url,
      raw_text,
    } = body as {
      title: string;
      source_type: string;
      reference_code?: string;
      official_url?: string;
      idcc?: string;
      url?: string;
      raw_text?: string;
    };

    if (!title || !source_type) {
      return new Response(JSON.stringify({ error: "title et source_type requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!url && !raw_text) {
      return new Response(JSON.stringify({ error: "Fournir url ou raw_text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Create source
    const { data: src, error: srcErr } = await admin
      .from("legal_sources")
      .insert({
        title,
        source_type,
        reference_code: reference_code ?? null,
        official_url: official_url ?? url ?? null,
        idcc: idcc ?? null,
        version_date: new Date().toISOString().slice(0, 10),
        created_by: userId,
      })
      .select("id")
      .single();
    if (srcErr || !src) throw new Error(`Création source: ${srcErr?.message}`);

    // 2. Create job
    const { data: job, error: jobErr } = await admin
      .from("ingestion_jobs")
      .insert({
        source_id: src.id,
        job_type: url ? "url_import" : "text_import",
        input_url: url ?? null,
        status: "running",
        triggered_by: userId,
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(`Création job: ${jobErr?.message}`);

    try {
      // 3. Fetch & clean text
      let text = raw_text ?? "";
      if (url) {
        const r = await fetch(url, {
          headers: { "User-Agent": "JurisAI-Ingest/1.0" },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
        const html = await r.text();
        text = stripHtml(html);
      }
      if (text.length < 100) {
        throw new Error(`Texte trop court (${text.length} chars)`);
      }
      // Cap to avoid runaway costs
      if (text.length > 200_000) text = text.slice(0, 200_000);

      // 4. Chunk + embed
      // Smart hierarchical chunking based on source type, fallback to paragraph chunker
      let chunks = smartChunk(text, source_type);
      if (chunks.length === 0) {
        chunks = chunkText(text, { targetChars: 3200, overlapChars: 200 });
      }
      const embeddings = await embedTexts(
        LOVABLE_API_KEY,
        chunks.map((c) => `${c.heading ?? ""}\n${c.content}`),
      );

      const rows = chunks.map((c, i) => ({
        source_id: src.id,
        chunk_index: i,
        content: c.content,
        heading: c.heading,
        embedding: embeddings[i] ?? null,
        token_count: Math.ceil(c.content.length / 4),
      }));
      const { error: chunkErr } = await admin.from("legal_chunks").insert(rows);
      if (chunkErr) throw new Error(`Insert chunks: ${chunkErr.message}`);

      await admin
        .from("ingestion_jobs")
        .update({
          status: "completed",
          chunks_created: rows.length,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return new Response(
        JSON.stringify({
          ok: true,
          source_id: src.id,
          job_id: job.id,
          chunks_created: rows.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown";
      await admin
        .from("ingestion_jobs")
        .update({
          status: "failed",
          error_message: msg,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      // Mark source inactive so it doesn't pollute search
      await admin.from("legal_sources").update({ is_active: false }).eq("id", src.id);
      throw e;
    }
  } catch (e) {
    console.error("ingest-legal-source error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
