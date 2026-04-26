// Edge function: legal-chat
// Streams responses from Lovable AI Gateway with a French labour-law expert system prompt.
// Enforces tenant quota via increment_questions_used RPC and persists messages.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Tu es **JurisAI**, un assistant expert en droit du travail français, conçu pour aider les juristes, RH et dirigeants d'entreprise.

## Tes domaines d'expertise
- Code du travail français (contrats, durée du travail, congés, ruptures)
- Conventions collectives (IDCC) et accords de branche
- URSSAF, cotisations sociales, prélèvements
- Inspection du travail, prud'hommes, contentieux social
- RGPD appliqué aux ressources humaines
- Jurisprudence récente (Cour de cassation, Conseil d'État)

## Règles de réponse
1. **Cite TOUJOURS tes sources** : articles du Code du travail (ex: "Article L1234-1"), arrêts (ex: "Cass. soc., 12 mars 2024, n°22-12345"), conventions collectives quand c'est pertinent.
2. **Structure tes réponses** avec des titres markdown (##, ###), des listes à puces, et **mets en gras** les points clés.
3. **Sois précis et opérationnel** : donne des conseils actionnables, pas seulement des principes généraux.
4. **Reconnais tes limites** : si une question dépasse le droit du travail français ou nécessite l'avis d'un avocat (contentieux complexe, montage juridique sensible), recommande explicitement de consulter un professionnel.
5. **Format des réponses** :
   - Commence par une **réponse synthétique en 2-3 phrases**
   - Puis développe avec une section **"📚 Cadre juridique"** (sources)
   - Puis **"✅ En pratique"** (étapes concrètes)
   - Puis **"⚠️ Points de vigilance"** si pertinent
6. **Ton professionnel mais accessible** : pas de jargon inutile, vulgarise si nécessaire.
7. **Date** : nous sommes en 2026, base-toi sur le droit en vigueur actuellement.

## Ce que tu ne fais JAMAIS
- Tu ne donnes pas de consultation juridique se substituant à un avocat
- Tu ne traites pas les questions hors droit du travail français (sauf RGPD RH)
- Tu n'inventes JAMAIS d'articles, d'arrêts ou de jurisprudence — si tu n'es pas sûr, dis-le`;

Deno.serve(async (req) => {
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

    // 1. Auth: extract user from Bearer token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // 2. Parse body
    const body = await req.json();
    const { conversationId, message, history } = body as {
      conversationId: string;
      message: string;
      history: Array<{ role: "user" | "assistant"; content: string }>;
    };
    if (!conversationId || !message?.trim()) {
      return new Response(JSON.stringify({ error: "Missing conversationId or message" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Service-role client for quota + DB writes
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 4. Verify conversation belongs to user + get tenant_id
    const { data: convo, error: convoErr } = await supabaseAdmin
      .from("conversations")
      .select("id, tenant_id, user_id, title")
      .eq("id", conversationId)
      .single();
    if (convoErr || !convo || convo.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Check + decrement quota atomically
    const { data: quotaOk, error: quotaErr } = await supabaseAdmin.rpc(
      "increment_questions_used",
      { _tenant_id: convo.tenant_id },
    );
    if (quotaErr) {
      console.error("Quota RPC error:", quotaErr);
      throw new Error("Quota check failed");
    }
    if (!quotaOk) {
      return new Response(
        JSON.stringify({
          error: "Quota mensuel atteint. Passez au plan supérieur pour continuer.",
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 6. Persist user message
    await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: message,
    });

    // 7. If first message, set conversation title from prompt
    if (!history || history.length === 0) {
      const title = message.slice(0, 80) + (message.length > 80 ? "…" : "");
      await supabaseAdmin
        .from("conversations")
        .update({ title })
        .eq("id", conversationId);
    }

    // 8. Call Lovable AI Gateway with streaming
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...(history ?? []),
          { role: "user", content: message },
        ],
        stream: true,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Trop de requêtes. Réessayez dans un instant." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits IA épuisés. Contactez votre administrateur." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "Erreur du service IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 9. Stream the response back AND collect it to persist the assistant message
    let assistantContent = "";
    const stream = new ReadableStream({
      async start(controller) {
        const reader = aiResponse.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Forward chunk to client
            controller.enqueue(value);

            // Also parse to accumulate assistant content
            buffer += decoder.decode(value, { stream: true });
            let newlineIdx: number;
            while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
              let line = buffer.slice(0, newlineIdx);
              buffer = buffer.slice(newlineIdx + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line.startsWith("data: ")) continue;
              const json = line.slice(6).trim();
              if (json === "[DONE]") continue;
              try {
                const parsed = JSON.parse(json);
                const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
                if (delta) assistantContent += delta;
              } catch {
                // partial; will be re-attempted
                buffer = line + "\n" + buffer;
                break;
              }
            }
          }
        } catch (e) {
          console.error("Stream error:", e);
        } finally {
          controller.close();
          // Persist assistant message (fire-and-forget, but awaited inside Deno task)
          if (assistantContent.trim()) {
            await supabaseAdmin.from("messages").insert({
              conversation_id: conversationId,
              role: "assistant",
              content: assistantContent,
            });
            await supabaseAdmin.from("usage_logs").insert({
              tenant_id: convo.tenant_id,
              user_id: userId,
              action: "legal_chat",
              metadata: { conversation_id: conversationId, length: assistantContent.length },
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
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
