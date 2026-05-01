import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, Plus, MessageSquare, Sparkles, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { sendChatMessage } from "@/server/chat.functions";
import {
  SourcesPanel,
  extractReferenced,
  renderCitationsInline,
  type CitationSource,
} from "@/components/chat/SourcesPanel";
import { MessageFeedback } from "@/components/app/MessageFeedback";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "Assistant IA · JurisAI" }] }),
  component: ChatPage,
});

type Msg = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: CitationSource[];
};

type Conversation = {
  id: string;
  title: string;
  created_at: string;
};

function ChatPage() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const sendChat = useServerFn(sendChatMessage);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load conversations
  useEffect(() => {
    if (!profile?.tenant_id) return;
    void (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("id, title, created_at")
        .eq("tenant_id", profile.tenant_id!)
        .order("created_at", { ascending: false })
        .limit(50);
      setConversations((data as Conversation[]) ?? []);
    })();
  }, [profile?.tenant_id]);

  // Load messages + citations of active conversation
  useEffect(() => {
    if (!activeConvoId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    void (async () => {
      const { data: msgRows } = await supabase
        .from("messages")
        .select("id, role, content")
        .eq("conversation_id", activeConvoId)
        .order("created_at", { ascending: true });

      const baseMsgs: Msg[] =
        ((msgRows as Array<{ id: string; role: string; content: string }>) ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content }));

      // Fetch citations for assistant messages
      const assistantIds = baseMsgs.filter((m) => m.role === "assistant" && m.id).map((m) => m.id!);
      if (assistantIds.length > 0) {
        const { data: cits } = await supabase
          .from("chat_citations")
          .select(
            "message_id, rank, score, chunk_id, legal_chunks(content, heading, legal_sources(id, title, source_type, reference_code, official_url))",
          )
          .in("message_id", assistantIds);
        const byMsg = new Map<string, CitationSource[]>();
        ((cits ?? []) as unknown as Array<{
          message_id: string;
          rank: number;
          score: number;
          chunk_id: string;
          legal_chunks: {
            content: string;
            heading: string | null;
            legal_sources: {
              id: string;
              title: string;
              source_type: string;
              reference_code: string | null;
              official_url: string | null;
            };
          };
        }>).forEach((c) => {
          const arr = byMsg.get(c.message_id) ?? [];
          arr.push({
            n: c.rank,
            chunk_id: c.chunk_id,
            source_id: c.legal_chunks?.legal_sources?.id ?? "",
            title: c.legal_chunks?.legal_sources?.title ?? "Source",
            reference: c.legal_chunks?.legal_sources?.reference_code ?? null,
            url: c.legal_chunks?.legal_sources?.official_url ?? null,
            type: c.legal_chunks?.legal_sources?.source_type ?? "manual",
            heading: c.legal_chunks?.heading ?? null,
            excerpt: (c.legal_chunks?.content ?? "").slice(0, 300),
          });
          byMsg.set(c.message_id, arr);
        });
        baseMsgs.forEach((m) => {
          if (m.id && byMsg.has(m.id)) {
            m.sources = byMsg.get(m.id)!.sort((a, b) => a.n - b.n);
          }
        });
      }

      setMessages(baseMsgs);
      setLoadingMessages(false);
    })();
  }, [activeConvoId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const newConversation = async () => {
    if (!profile?.tenant_id || !user) return;
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        title: "Nouvelle question",
      })
      .select("id, title, created_at")
      .single();
    if (error || !data) {
      toast.error("Impossible de créer la conversation", { description: error?.message });
      return null;
    }
    const newConvo = data as Conversation;
    setConversations((prev) => [newConvo, ...prev]);
    setActiveConvoId(newConvo.id);
    setMessages([]);
    return newConvo.id;
  };

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    let convoId: string | null = activeConvoId;
    if (!convoId) {
      const created = await newConversation();
      if (!created) return;
      convoId = created;
    }

    setInput("");
    const userMsg: Msg = { role: "user", content: text };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);

    try {
      const result = await sendChat({
        data: { conversationId: convoId, message: text, history },
      });

      const assistantMsg: Msg = {
        id: result.message_id,
        role: "assistant",
        content: result.content,
        sources: result.sources as CitationSource[],
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Refresh conversation list (title may have changed)
      const { data: refreshed } = await supabase
        .from("conversations")
        .select("id, title, created_at")
        .eq("tenant_id", profile!.tenant_id!)
        .order("created_at", { ascending: false })
        .limit(50);
      setConversations((refreshed as Conversation[]) ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      toast.error("Échec de la requête", { description: msg });
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  };

  if (!profile) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      </AppShell>
    );
  }

  if (!profile.tenant_id) {
    return (
      <AppShell>
        <div className="rounded-3xl border border-border bg-card p-8 text-center shadow-[var(--shadow-card)]">
          <AlertCircle className="mx-auto h-10 w-10 text-accent" />
          <h2 className="mt-4 text-lg font-semibold">Onboarding requis</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Terminez la configuration de votre entreprise pour utiliser l'assistant.
          </p>
          <button
            type="button"
            onClick={() => void navigate({ to: "/onboarding" })}
            className="mt-4 rounded-xl bg-gradient-to-br from-primary to-accent px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Compléter l'onboarding
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="glass-panel hidden w-[260px] flex-shrink-0 flex-col rounded-3xl p-3 shadow-[var(--shadow-card)] lg:flex">
          <button
            type="button"
            onClick={() => void newConversation()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
          >
            <Plus className="h-4 w-4" />
            Nouvelle question
          </button>

          <div className="mt-4 flex-1 space-y-1 overflow-y-auto">
            {conversations.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-muted-foreground">
                Aucune conversation pour le moment.
              </p>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveConvoId(c.id)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition",
                  activeConvoId === c.id
                    ? "bg-accent-soft text-accent-soft-foreground"
                    : "text-foreground/80 hover:bg-secondary",
                )}
              >
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 opacity-60" />
                <span className="line-clamp-2 text-[12.5px] font-medium">{c.title}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="glass-panel flex min-w-0 flex-1 flex-col rounded-3xl shadow-[var(--shadow-card)]">
          <header className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-[15px] font-semibold text-foreground">
                  Assistant juridique IA
                </h1>
                <p className="text-[11.5px] text-muted-foreground">
                  Sourcé sur Code du travail, conventions collectives, jurisprudence
                </p>
              </div>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
            {loadingMessages ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
              </div>
            ) : messages.length === 0 ? (
              <EmptyState onPick={(q) => setInput(q)} />
            ) : (
              <div className="mx-auto max-w-3xl space-y-6">
                {messages.map((m, i) => (
                  <MessageBubble
                    key={m.id ?? i}
                    role={m.role}
                    content={m.content}
                    sources={m.sources}
                    messageId={m.id}
                    tenantId={profile?.tenant_id ?? null}
                  />
                ))}
                {streaming && messages[messages.length - 1]?.role === "user" && (
                  <MessageBubble role="assistant" content="" loading />
                )}
              </div>
            )}
          </div>

          <form onSubmit={sendMessage} className="border-t border-border p-4">
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage(e as unknown as FormEvent);
                  }
                }}
                placeholder="Posez une question juridique… (ex : Délai de préavis pour un cadre)"
                rows={1}
                disabled={streaming}
                className="min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-background px-4 py-3 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
                style={{ maxHeight: "160px" }}
              />
              <button
                type="submit"
                disabled={streaming || !input.trim()}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-50"
              >
                {streaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">
              JurisAI cite ses sources officielles. Vérifiez les informations critiques.
            </p>
          </form>
        </section>
      </div>
    </AppShell>
  );
}

function MessageBubble({
  role,
  content,
  loading,
  sources,
  messageId,
  tenantId,
}: {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
  sources?: CitationSource[];
  messageId?: string;
  tenantId?: string | null;
}) {
  const isUser = role === "user";
  const meta = !isUser ? extractMeta(content) : null;
  const cleanContent = !isUser ? stripMeta(content) : content;
  const referenced = !isUser && cleanContent ? extractReferenced(cleanContent) : new Set<number>();
  const renderedContent = !isUser && sources ? renderCitationsInline(cleanContent, sources) : cleanContent;

  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed",
          isUser
            ? "bg-gradient-to-br from-primary to-accent text-primary-foreground"
            : "border border-border bg-card text-foreground",
        )}
      >
        {loading ? (
          <div className="flex gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-accent" />
          </div>
        ) : isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <>
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-strong:text-foreground prose-code:rounded prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px] prose-code:font-medium prose-code:text-accent prose-code:before:content-none prose-code:after:content-none prose-a:text-accent prose-a:font-semibold prose-a:no-underline hover:prose-a:underline">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderedContent}</ReactMarkdown>
            </div>
            {sources && sources.length > 0 && (
              <SourcesPanel sources={sources} referenced={referenced} />
            )}
            {meta && <ConfidenceBadge meta={meta} />}
            {messageId && tenantId && (
              <MessageFeedback messageId={messageId} tenantId={tenantId} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "Quel est le délai de préavis pour un licenciement de cadre ?",
  "Comment calculer une indemnité de rupture conventionnelle ?",
  "Quelles sont les obligations en matière de RGPD pour un service RH ?",
  "Un salarié peut-il refuser une modification de son contrat de travail ?",
];

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
        <Sparkles className="h-7 w-7" />
      </div>
      <h2 className="mt-5 text-[22px] font-bold tracking-tight text-foreground">
        Bonjour, comment puis-je vous aider ?
      </h2>
      <p className="mt-2 text-[14px] text-muted-foreground">
        Posez une question sur le droit du travail français — chaque réponse cite ses sources
        officielles.
      </p>
      <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border border-border bg-card p-4 text-left text-[13px] text-foreground transition hover:border-accent hover:bg-accent-soft"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- META block (S3: structured agent output) ----
type AgentMeta = {
  short_answer?: string;
  confidence?: number;
  needs_more_info?: boolean;
  legal_basis?: string[];
};

const META_RE = /<!--META-->\s*```json\s*([\s\S]*?)\s*```\s*<!--\/META-->/i;

function extractMeta(text: string): AgentMeta | null {
  const m = text.match(META_RE);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as AgentMeta;
  } catch {
    return null;
  }
}

function stripMeta(text: string): string {
  return text.replace(META_RE, "").trim();
}

function ConfidenceBadge({ meta }: { meta: AgentMeta }) {
  const conf = typeof meta.confidence === "number" ? meta.confidence : null;
  const tone =
    conf === null ? "neutral" : conf >= 0.8 ? "good" : conf >= 0.5 ? "warn" : "bad";
  const colors: Record<string, string> = {
    good: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    warn: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    bad: "bg-rose-500/10 text-rose-600 border-rose-500/30",
    neutral: "bg-secondary text-muted-foreground border-border",
  };
  return (
    <div className={cn("mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]", colors[tone])}>
      {conf !== null && (
        <span className="font-semibold">Confiance · {(conf * 100).toFixed(0)}%</span>
      )}
      {meta.needs_more_info && (
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-700">
          ⚠ Précisions requises
        </span>
      )}
      {meta.legal_basis && meta.legal_basis.length > 0 && (
        <span className="text-muted-foreground">
          · {meta.legal_basis.length} fondement{meta.legal_basis.length > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
