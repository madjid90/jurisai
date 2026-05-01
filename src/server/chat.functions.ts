// Assistant juridique (mode RAG simple, non-streaming).
// Migré depuis l'edge function `legal-chat` pour respecter la Core rule :
// "Jamais d'edge function pour le métier app — utiliser createServerFn".
//
// Fonctionnalités préservées :
//  - RAG hybride (vector + FTS) via searchLegalSources
//  - Filtrage IDCC du tenant
//  - Quotas + rate-limit (10 req/min)
//  - Persistance message user + assistant + citations [source:N]
//  - Audit usage_logs
//  - Trust score basique
//
// Différence : pas de streaming SSE — la réponse est renvoyée d'un coup.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { searchLegalSources, type LegalSource } from "./_shared/legal-rag.server";

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const CHAT_MODEL = "google/gemini-3-flash-preview";

const SYSTEM_PROMPT = `Tu es **JurisAI**, assistant juridique transverse pour cabinets et entreprises (RH, commercial, sociétés, RGPD, fiscal, contentieux, administratif).

RÈGLES STRICTES :
1. Toute affirmation juridique DOIT être étayée par une source du bloc <SOURCES> via la notation [source:N].
2. Si aucune source pertinente n'est fournie, refuse poliment : "Je n'ai pas de source officielle suffisante pour répondre."
3. Réponds en français, structure claire (titres, listes), ton professionnel.
4. Mentionne les limites : la réponse est indicative, pas un avis juridique.

Date courante : 2026.`;

export type ChatSourceOut = {
  n: number;
  chunk_id: string;
  source_id: string;
  title: string;
  reference: string | null;
  url: string | null;
  type: string | null;
  heading: string | null;
  excerpt: string;
};

export type ChatRunOutput = {
  message_id: string;
  content: string;
  sources: ChatSourceOut[];
  trust_score: number;
  refused: boolean;
};

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        message: z.string().trim().min(1).max(4000),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(8000),
            }),
          )
          .max(40)
          .optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ChatRunOutput> => {
    const { userId } = context as { userId: string };
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY manquant côté serveur");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;

    // 1. Vérifier la conversation et le tenant
    const { data: convo, error: convoErr } = await sb
      .from("conversations")
      .select("id, tenant_id, user_id, title")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (convoErr || !convo || convo.user_id !== userId) {
      throw new Error("Conversation introuvable");
    }
    const tenantId: string = convo.tenant_id;

    // 2. Rate limit (10/min)
    const { data: rl } = await sb.rpc("check_rate_limit", {
      p_user_id: userId,
      p_endpoint: "legal-chat",
      p_max_per_minute: 10,
    });
    if (Array.isArray(rl) && rl[0] && !rl[0].allowed) {
      throw new Error(`Trop de requêtes (${rl[0].current_count}/min). Réessayez dans une minute.`);
    }

    // 3. Quota mensuel
    const { data: quotaOk } = await sb.rpc("increment_questions_used", {
      _tenant_id: tenantId,
    });
    if (!quotaOk) throw new Error("Quota mensuel atteint.");

    // 4. IDCC du tenant pour filtrage RAG
    const { data: tenant } = await sb
      .from("tenants").select("idcc").eq("id", tenantId).maybeSingle();
    const idcc: string | null = tenant?.idcc ?? null;

    // 5. Persister le message user
    const { data: userMsgRow } = await sb
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        role: "user",
        content: data.message,
      })
      .select("id")
      .single();

    // 6. Si premier message → titre de conversation
    if (!data.history || data.history.length === 0) {
      const title = data.message.slice(0, 80) + (data.message.length > 80 ? "…" : "");
      await sb.from("conversations").update({ title }).eq("id", data.conversationId);
    }

    // 7. RAG : récupérer les sources juridiques
    const rag = await searchLegalSources(data.message, { idcc, limit: 8 });
    const sources: LegalSource[] = rag.sources;

    // Trust score
    const distinctSources = new Set(sources.map((s) => s.source_id)).size;
    const topScore = sources[0]?.score ?? 0;
    const trustScore = sources.length === 0
      ? 0
      : Math.min(1, 0.4 * Math.min(1, distinctSources / 3) +
          0.4 * Math.min(1, topScore / 0.05) +
          0.2 * Math.min(1, sources.length / 8));

    // 8. Construire le prompt
    const sourcesBlock = sources.length > 0
      ? sources
          .map((s) => {
            const ref = s.reference ? ` (${s.reference})` : "";
            const url = s.url ? `\nURL: ${s.url}` : "";
            return `[source:${s.n}] ${s.title}${ref}${url}\n${s.excerpt}`;
          })
          .join("\n\n---\n\n")
      : "(Aucune source officielle pertinente trouvée.)";

    const systemPrompt = `${SYSTEM_PROMPT}\n\n<SOURCES>\n${sourcesBlock}\n</SOURCES>`;

    // 9. Appel IA (non-streaming)
    const aiRes = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...(data.history ?? []),
          { role: "user", content: data.message },
        ],
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) throw new Error("Trop de requêtes IA. Réessayez.");
      if (aiRes.status === 402) throw new Error("Crédits IA épuisés. Contactez votre administrateur.");
      const txt = await aiRes.text().catch(() => "");
      console.error("AI gateway error", aiRes.status, txt);
      throw new Error("Erreur du service IA");
    }

    const aiJson = await aiRes.json();
    const content: string = aiJson.choices?.[0]?.message?.content ?? "";
    const refused = !content.trim() || (sources.length === 0 && /pas de source/i.test(content));

    // 10. Persister le message assistant
    const { data: assistantMsg } = await sb
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        role: "assistant",
        content,
      })
      .select("id")
      .single();

    const assistantMsgId: string = assistantMsg?.id;

    // 11. Persister les citations [source:N] effectivement utilisées
    if (assistantMsgId && sources.length > 0) {
      const referenced = new Set<number>();
      const re = /\[source:(\d+)\]/g;
      let m;
      while ((m = re.exec(content)) !== null) {
        referenced.add(parseInt(m[1], 10));
      }
      const rows = [...referenced]
        .filter((n) => n >= 1 && n <= sources.length)
        .map((n) => ({
          message_id: assistantMsgId,
          chunk_id: sources[n - 1].chunk_id,
          tenant_id: tenantId,
          rank: n,
          score: sources[n - 1].score,
        }));
      if (rows.length > 0) {
        await sb.from("chat_citations").insert(rows);
      }
    }

    // 12. Audit usage
    await sb.from("usage_logs").insert({
      tenant_id: tenantId,
      user_id: userId,
      action: "legal_chat",
      metadata: {
        conversation_id: data.conversationId,
        length: content.length,
        chunks_retrieved: sources.length,
        user_message_id: userMsgRow?.id,
        trust_score: Number(trustScore.toFixed(3)),
        refused,
      },
    });

    const sourcesOut: ChatSourceOut[] = sources.map((s) => ({
      n: s.n,
      chunk_id: s.chunk_id,
      source_id: s.source_id,
      title: s.title,
      reference: s.reference,
      url: s.url,
      type: s.source_type,
      heading: s.heading,
      excerpt: s.excerpt,
    }));

    return {
      message_id: assistantMsgId,
      content,
      sources: sourcesOut,
      trust_score: Number(trustScore.toFixed(3)),
      refused,
    };
  });
