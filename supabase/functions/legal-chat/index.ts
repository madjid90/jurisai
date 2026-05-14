// Edge function: legal-chat (RAG mode)
// 1. Embed the user question
// 2. Run hybrid_search (vector + BM25) on legal_chunks, filtered by tenant IDCC
// 3. Inject top chunks into the system prompt as authoritative context
// 4. Stream the LLM answer
// 5. Persist citations linking each used chunk to the assistant message

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sanitizeQuery, mmrRerank, logEvent } from "../_shared/rag.ts";
import { PROMPTS_BY_MODE, type RagMode } from "../_shared/rag-prompts.ts";
import { validateAnswerCitations } from "../_shared/citation-validator.ts";
import { verifyReferences } from "../_shared/reference-verifier.ts";

import { corsHeadersFor } from "../_shared/cors.ts";
const EMBED_MODEL = "openai/text-embedding-3-small";
const CHAT_MODEL = "google/gemini-2.5-pro";

interface ChunkResult {
  chunk_id: string;
  source_id: string;
  content: string;
  heading: string | null;
  source_title: string;
  source_type: string;
  reference_code: string | null;
  official_url: string | null;
  score: number;
  embedding?: number[] | string | null;
}

function parseEmbedding(e: ChunkResult["embedding"]): number[] | undefined {
  if (!e) return undefined;
  if (Array.isArray(e)) return e as number[];
  if (typeof e === "string") {
    // Postgres vector text repr: "[0.1,0.2,...]"
    try {
      const arr = JSON.parse(e);
      return Array.isArray(arr) ? (arr as number[]) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required env vars");
    }

    // 1. Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonErr("Missing authorization", 401, corsHeaders);
    }
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser(accessToken);
    if (userErr || !userData.user) return jsonErr("Invalid session", 401, corsHeaders);
    const userId = userData.user.id;

    // 2. Body
    const body = await req.json();
    const { conversationId, message, history } = body as {
      conversationId: string;
      message: string;
      history: Array<{ role: "user" | "assistant"; content: string }>;
    };
    if (!conversationId || !message?.trim()) {
      return jsonErr("Missing conversationId or message", 400, corsHeaders);
    }

    // Sanitize: anti prompt-injection + length cap. Used for embedding & retrieval.
    // Original `message` is still persisted as-is (user's literal input).
    const safeQuery = sanitizeQuery(message);
    if (!safeQuery) return jsonErr("Question vide après filtrage.", 400, corsHeaders);

    const t0 = Date.now();

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 3. Verify conversation + tenant
    const { data: convo, error: convoErr } = await supabaseAdmin
      .from("conversations")
      .select("id, tenant_id, user_id, title")
      .eq("id", conversationId)
      .single();
    if (convoErr || !convo || convo.user_id !== userId) {
      return jsonErr("Conversation not found", 404, corsHeaders);
    }

    // 4. Tenant IDCC for filtering
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("idcc, rag_mode")
      .eq("id", convo.tenant_id)
      .single();
    const idccFilter = tenant?.idcc ?? null;
    const ragMode: RagMode =
      (tenant?.rag_mode as RagMode | undefined) ?? "strict";

    // 4.5 Rate limit (10 req/min/user) — protection coût IA + DoS
    const { data: rl, error: rlErr } = await supabaseAdmin.rpc("check_rate_limit", {
      p_user_id: userId,
      p_endpoint: "legal-chat",
      p_max_per_minute: 10,
    });
    if (rlErr) {
      console.error("Rate limit check error:", rlErr);
    } else if (Array.isArray(rl) && rl[0] && !rl[0].allowed) {
      return jsonErr(
        `Trop de requêtes (${rl[0].current_count}/min). Réessayez dans une minute.`,
        429,
        corsHeaders,
      );
    }

    // 5. Quota
    const { data: quotaOk, error: quotaErr } = await supabaseAdmin.rpc(
      "increment_questions_used",
      { _tenant_id: convo.tenant_id },
    );
    if (quotaErr) {
      console.error("Quota error:", quotaErr);
      throw new Error("Quota check failed");
    }
    if (!quotaOk) {
      return jsonErr("Quota mensuel atteint. Passez au plan supérieur pour continuer.", 402, corsHeaders);
    }

    // 6. Persist user message
    const { data: userMsgRow } = await supabaseAdmin
      .from("messages")
      .insert({ conversation_id: conversationId, role: "user", content: message })
      .select("id")
      .single();

    // 7. First message: set conversation title
    if (!history || history.length === 0) {
      const title = message.slice(0, 80) + (message.length > 80 ? "…" : "");
      await supabaseAdmin.from("conversations").update({ title }).eq("id", conversationId);
    }

    // 8. RAG: embed the (sanitized) question + hybrid_search + MMR re-rank
    // S2 — embedding cache: hash sanitized query, look up cached vector first.
    let chunks: ChunkResult[] = [];
    const tEmbStart = Date.now();
    let embedMs = 0;
    let searchMs = 0;
    let cacheHit = false;
    let embedding: number[] = [];

    // Compute SHA-256 hash of the sanitized query (lowercased, trimmed).
    const normalized = safeQuery.toLowerCase().trim();
    const hashBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(normalized),
    );
    const queryHash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    try {
      // Cache lookup
      const { data: cached } = await supabaseAdmin
        .from("embedding_cache")
        .select("embedding")
        .eq("query_hash", queryHash)
        .maybeSingle();
      if (cached?.embedding) {
        const parsed = parseEmbedding(cached.embedding as never);
        if (parsed && parsed.length > 0) {
          embedding = parsed;
          cacheHit = true;
          embedMs = Date.now() - tEmbStart;
          // BUG-R4 : on incrémente le compteur via RPC au lieu de l'écraser à 1.
          void supabaseAdmin.rpc("increment_embedding_cache_hit", { _query_hash: queryHash }).then((r: { error: unknown }) => {
            if (r.error) {
              // fallback : best-effort, on ne touche que last_hit_at sans toucher hit_count
              void supabaseAdmin
                .from("embedding_cache")
                .update({ last_hit_at: new Date().toISOString() })
                .eq("query_hash", queryHash);
            }
          });
        }
      }

      if (!cacheHit) {
        const embRes = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: EMBED_MODEL, input: [safeQuery] }),
        });
        embedMs = Date.now() - tEmbStart;
        if (embRes.ok) {
          const embJson = await embRes.json();
          embedding = embJson.data?.[0]?.embedding ?? [];
          // Persist in cache (ignore conflicts)
          if (embedding.length > 0) {
            void supabaseAdmin
              .from("embedding_cache")
              .insert({
                query_hash: queryHash,
                embedding: embedding as unknown as string,
              });
          }
        } else {
          console.error("Embedding failed:", await embRes.text());
        }
      }

      if (embedding.length > 0) {
        const tSearch = Date.now();
        // Over-fetch (16) then MMR-rerank to 8 for diversity.
        const { data: results, error: searchErr } = await supabaseAdmin.rpc("hybrid_search", {
          query_embedding: embedding as unknown as string,
          query_text: safeQuery,
          match_count: 16,
          idcc_filter: idccFilter,
        });
        searchMs = Date.now() - tSearch;
        if (searchErr) console.error("hybrid_search error:", searchErr);
        const raw = (results ?? []) as ChunkResult[];
        // hybrid_search now returns embeddings → MMR can truly diversify.
        chunks = mmrRerank(
          raw.map((c) => ({
            ...c,
            score: c.score ?? 0,
            embedding: parseEmbedding(c.embedding),
          })),
          8,
          0.7,
        );
      }
    } catch (e) {
      console.error("RAG retrieval failed:", e);
      // Continue without RAG context — degrade gracefully
    }

    // S2 — Trust score: agrégation simple basée sur les sources retrouvées.
    // - Plus de sources distinctes = plus fiable
    // - Top score élevé = forte pertinence
    // - Au moins 1 source de niveau autorité haute = bonus
    const distinctSources = new Set(chunks.map((c) => c.source_id)).size;
    const topScore = chunks[0]?.score ?? 0;
    const trustScore = Math.min(
      1,
      Math.max(
        0,
        chunks.length === 0
          ? 0
          : 0.4 * Math.min(1, distinctSources / 3) +
              0.4 * Math.min(1, topScore / 0.05) +
              0.2 * Math.min(1, chunks.length / 8),
      ),
    );

    logEvent("rag.retrieve", {
      user_id: userId,
      tenant_id: convo.tenant_id,
      conversation_id: conversationId,
      idcc: idccFilter,
      embed_ms: embedMs,
      search_ms: searchMs,
      chunks_count: chunks.length,
      query_len: safeQuery.length,
      cache_hit: cacheHit,
      trust_score: Number(trustScore.toFixed(3)),
      distinct_sources: distinctSources,
    });

    // 9. Build system prompt with sources (mode-aware)
    let systemPrompt = PROMPTS_BY_MODE[ragMode];
    if (chunks.length > 0) {
      const sourcesBlock = chunks
        .map((c, i) => {
          const ref = c.reference_code ? ` (${c.reference_code})` : "";
          const url = c.official_url ? `\nURL: ${c.official_url}` : "";
          return `[source:${i + 1}] ${c.source_title}${ref}${url}\n${c.content.slice(0, 1500)}`;
        })
        .join("\n\n---\n\n");
      systemPrompt += `\n\n<SOURCES>\n${sourcesBlock}\n</SOURCES>`;
    } else {
      systemPrompt += `\n\n<SOURCES>\n(Aucune source officielle pertinente trouvée.)\n</SOURCES>`;
    }

    // 9b. Sanitize history entries — client-sent content is untrusted.
    // Cap each message to 6000 chars and strip injection patterns.
    const sanitizedHistory = (history ?? [])
      .filter((m: { role: string; content: string }) => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
      .map((m: { role: "user" | "assistant"; content: string }) => ({
        role: m.role,
        content: m.role === "user" ? sanitizeQuery(m.content.slice(0, 6000)) : m.content.slice(0, 6000),
      }))
      .filter((m: { content: string }) => m.content.trim().length > 0);

    // LOT 5 — Fenêtre glissante : si l'historique > 10 messages, on résume
    // les anciens via un appel LLM léger et on conserve les 10 derniers tels quels.
    // Évite l'explosion du contexte tout en préservant la mémoire conversationnelle.
    const MAX_FULL_TURNS = 10;
    const fullHistory = sanitizedHistory;
    let condensedHistory = fullHistory;
    if (fullHistory.length > MAX_FULL_TURNS) {
      const toSummarize = fullHistory.slice(0, fullHistory.length - MAX_FULL_TURNS);
      const recent = fullHistory.slice(-MAX_FULL_TURNS);
      try {
        const sumCtrl = new AbortController();
        const sumTimeout = setTimeout(() => sumCtrl.abort("timeout"), 15_000);
        const sumRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content:
                  "Résume en 5-8 puces factuelles l'échange suivant entre un utilisateur et un assistant juridique. Conserve : questions posées, points juridiques évoqués, références citées, décisions prises. Pas de fioritures.",
              },
              {
                role: "user",
                content: toSummarize
                  .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
                  .join("\n\n"),
              },
            ],
            stream: false,
          }),
          signal: sumCtrl.signal,
        }).finally(() => clearTimeout(sumTimeout));
        if (sumRes.ok) {
          const sumJson = await sumRes.json();
          const summary = sumJson?.choices?.[0]?.message?.content?.trim();
          if (summary) {
            condensedHistory = [
              {
                role: "assistant",
                content: `[Résumé de la conversation antérieure]\n${summary}`,
              },
              ...recent,
            ];
            logEvent("rag.history_condensed", {
              tenant_id: convo.tenant_id,
              conversation_id: conversationId,
              original_turns: fullHistory.length,
              summarized_turns: toSummarize.length,
              kept_turns: recent.length,
            });
          }
        }
      } catch (e) {
        console.warn("[legal-chat] history summary failed, fallback to last turns", e);
        condensedHistory = recent;
      }
    }

    // 10. Call AI Gateway streaming with timeout (60s) + 1 retry on transient errors
    const callGateway = async (): Promise<Response> => {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort("timeout"), 60_000);
      try {
        return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: CHAT_MODEL,
            messages: [
              { role: "system", content: systemPrompt },
              ...condensedHistory,
              { role: "user", content: safeQuery },
            ],
            stream: true,
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    };

    let aiResponse: Response;
    try {
      aiResponse = await callGateway();
      // Retry once on 5xx (transient gateway error)
      if (aiResponse.status >= 500 && aiResponse.status < 600) {
        await new Promise((r) => setTimeout(r, 800));
        aiResponse = await callGateway();
      }
    } catch (e) {
      console.error("AI gateway fetch failed:", e);
      return jsonErr("Le service IA est temporairement indisponible. Réessayez.", 503, corsHeaders);
    }

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) return jsonErr("Trop de requêtes. Réessayez dans un instant.", 429, corsHeaders);
      if (aiResponse.status === 402) return jsonErr("Crédits IA épuisés. Contactez votre administrateur.", 402, corsHeaders);
      const errText = await aiResponse.text();
      console.error("AI gateway error", aiResponse.status, errText);
      return jsonErr("Erreur du service IA", 500, corsHeaders);
    }

    // 11. Send sources metadata FIRST as a SSE prelude, then forward the LLM stream
    let assistantContent = "";
    const sourcesPayload = chunks.map((c, i) => ({
      n: i + 1,
      chunk_id: c.chunk_id,
      source_id: c.source_id,
      title: c.source_title,
      reference: c.reference_code,
      url: c.official_url,
      type: c.source_type,
      heading: c.heading,
      excerpt: c.content.slice(0, 300),
    }));

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        // Prelude with sources + trust score (custom events)
        controller.enqueue(
          encoder.encode(`event: sources\ndata: ${JSON.stringify(sourcesPayload)}\n\n`),
        );
        controller.enqueue(
          encoder.encode(
            `event: trust\ndata: ${JSON.stringify({
              score: Number(trustScore.toFixed(3)),
              distinct_sources: distinctSources,
              chunks: chunks.length,
              cache_hit: cacheHit,
            })}\n\n`,
          ),
        );


        const reader = aiResponse.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);

            buffer += decoder.decode(value, { stream: true });
            let nlIdx: number;
            while ((nlIdx = buffer.indexOf("\n")) !== -1) {
              let line = buffer.slice(0, nlIdx);
              buffer = buffer.slice(nlIdx + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line.startsWith("data: ")) continue;
              const json = line.slice(6).trim();
              if (json === "[DONE]") continue;
              try {
                const parsed = JSON.parse(json);
                const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
                if (delta) assistantContent += delta;
              } catch {
                buffer = line + "\n" + buffer;
                break;
              }
            }
          }
        } catch (e) {
          console.error("Stream error:", e);
        } finally {
          controller.close();

          if (assistantContent.trim()) {
            const { data: assistantMsg } = await supabaseAdmin
              .from("messages")
              .insert({
                conversation_id: conversationId,
                role: "assistant",
                content: assistantContent,
              })
              .select("id, created_at")
              .single();

            // Persist citations only for chunks actually referenced [source:N] in the answer
            if (assistantMsg && chunks.length > 0) {
              const referenced = new Set<number>();
              const re = /\[source:(\d+)\]/g;
              let m;
              while ((m = re.exec(assistantContent)) !== null) {
                referenced.add(parseInt(m[1], 10));
              }
              const rows = [...referenced]
                .filter((n) => n >= 1 && n <= chunks.length)
                .map((n) => ({
                  message_id: assistantMsg.id,
                  message_created_at: assistantMsg.created_at,
                  chunk_id: chunks[n - 1].chunk_id,
                  tenant_id: convo.tenant_id,
                  rank: n,
                  score: chunks[n - 1].score,
                }));
              if (rows.length > 0) {
                await supabaseAdmin.from("chat_citations").insert(rows);
              }
            }

            await supabaseAdmin.from("usage_logs").insert({
              tenant_id: convo.tenant_id,
              user_id: userId,
              action: "legal_chat",
              metadata: {
                conversation_id: conversationId,
                length: assistantContent.length,
                chunks_retrieved: chunks.length,
                user_message_id: userMsgRow?.id,
              },
            });

            // Validate citation coverage of the final answer
            const validation = validateAnswerCitations(assistantContent, chunks.length);
            if (validation.should_warn) {
              logEvent("rag.citation_warning", {
                user_id: userId,
                tenant_id: convo.tenant_id,
                conversation_id: conversationId,
                coverage: validation.citation_coverage_score,
                invalid_citations: validation.invalid_citations,
                unsupported_count: validation.unsupported_claims.length,
              });
            }

            // LOT 5 RAG — Vérification post-réponse : les références juridiques
            // citées dans la réponse existent-elles bien dans `legal_reference_index` ?
            const refCheck = await verifyReferences(
              SUPABASE_URL,
              SUPABASE_SERVICE_ROLE_KEY,
              assistantContent,
            );
            if (refCheck.should_warn) {
              logEvent("rag.reference_warning", {
                user_id: userId,
                tenant_id: convo.tenant_id,
                conversation_id: conversationId,
                score: refCheck.verification_score,
                unknown: refCheck.references_unknown.slice(0, 10),
                found_count: refCheck.references_found.length,
              });
            }

            logEvent("rag.complete", {
              user_id: userId,
              tenant_id: convo.tenant_id,
              conversation_id: conversationId,
              total_ms: Date.now() - t0,
              answer_len: assistantContent.length,
              chunks_used: chunks.length,
              citations: [...new Set([...assistantContent.matchAll(/\[source:(\d+)\]/g)].map(m => m[1]))].length,
              citation_coverage: validation.citation_coverage_score,
              reference_score: refCheck.verification_score,
              references_unknown: refCheck.references_unknown.length,
              rag_mode: ragMode,
            });
          }
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("legal-chat error:", e);
    return jsonErr(e instanceof Error ? e.message : "Unknown error", 500, corsHeaders);
  }
});

function jsonErr(msg: string, status: number, hdrs: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...hdrs, "Content-Type": "application/json" },
  });
}
