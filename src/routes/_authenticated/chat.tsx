// Page /chat — interface conversationnelle type ChatGPT branchée sur l'agent
// juridique RAG. Chaque réponse est sourcée via [source:N] depuis legal_chunks.
// Pas de persistance pour l'instant : l'historique vit dans la session.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Send, Sparkles, BookMarked, ExternalLink, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { runLegalAgent } from "@/server/agent.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "Chat juridique · JurisAI" }] }),
  component: ChatPage,
});

type Source = { n: number; title: string; ref: string | null; url: string | null };

type Msg =
  | { role: "user"; content: string; id: string }
  | {
      role: "assistant";
      content: string;
      id: string;
      sources?: Source[];
      refused?: boolean;
      pending?: boolean;
    };

const STARTERS = [
  "Quels sont les délais légaux d'une rupture conventionnelle ?",
  "Quelles clauses obligatoires dans un contrat fournisseur ?",
  "Comment se conformer au RGPD pour un site e-commerce ?",
  "Quelles sont les étapes d'une procédure disciplinaire ?",
];

function ChatPage() {
  const ask = useServerFn(runLegalAgent);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const userMsg: Msg = { role: "user", content: q, id: crypto.randomUUID() };
    const placeholder: Msg = {
      role: "assistant",
      content: "",
      id: crypto.randomUUID(),
      pending: true,
    };
    setMessages((m) => [...m, userMsg, placeholder]);

    try {
      const res = (await ask({ data: { message: q } })) as {
        answer: string;
        sources: Source[];
        refused: boolean;
        refusal_reason: string | null;
      };
      setMessages((m) =>
        m.map((msg) =>
          msg.id === placeholder.id
            ? {
                ...msg,
                content: res.refused
                  ? res.refusal_reason || "Je ne peux pas répondre sans source juridique fiable."
                  : res.answer,
                sources: res.sources,
                refused: res.refused,
                pending: false,
              }
            : msg,
        ),
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Erreur inconnue";
      toast.error(errMsg);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === placeholder.id
            ? { ...msg, content: `⚠️ ${errMsg}`, pending: false, refused: true }
            : msg,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (busy) return;
    setMessages([]);
  };

  return (
    <AppShell>
      <div className="mx-auto flex h-[calc(100vh-7rem)] w-full max-w-4xl flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Chat juridique</h1>
              <p className="text-[11px] text-muted-foreground">
                Réponses sourcées sur les sources légales officielles
              </p>
            </div>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Nouveau
            </Button>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-6">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-semibold tracking-tight">Comment puis-je vous aider ?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Posez une question juridique. JurisAI consulte les sources officielles et cite ses
                références.
              </p>
              <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-xl border border-border bg-background/60 p-3 text-left text-sm transition hover:border-primary/40 hover:bg-secondary/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((m) => (
                <MessageBubble key={m.id} msg={m} />
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border/40 pt-3">
          <div className="rounded-2xl border border-border bg-background/70 p-3 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Posez votre question juridique…"
              rows={2}
              disabled={busy}
              className="min-h-[56px] resize-none border-0 bg-transparent p-1 text-[15px] focus-visible:ring-0"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                Entrée pour envoyer · Maj+Entrée pour aller à la ligne
              </span>
              <Button onClick={() => void send()} disabled={busy || !input.trim()} size="sm">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Send className="mr-1 h-3.5 w-3.5" />
                    Envoyer
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        {msg.pending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            JurisAI consulte les sources…
          </div>
        ) : (
          <>
            <div
              className={cn(
                "prose prose-sm max-w-none rounded-2xl border bg-background/60 px-4 py-3 text-sm leading-relaxed",
                msg.refused ? "border-destructive/30 bg-destructive/5" : "border-border/60",
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
            {msg.sources && msg.sources.length > 0 && (
              <SourcesList sources={msg.sources} answer={msg.content} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SourcesList({ sources, answer }: { sources: Source[]; answer: string }) {
  // Filter to sources actually cited in the answer
  const refs = new Set<number>();
  const re = /\[source:(\d+)\]/g;
  let m;
  while ((m = re.exec(answer)) !== null) refs.add(parseInt(m[1], 10));
  const visible = refs.size > 0 ? sources.filter((s) => refs.has(s.n)) : sources.slice(0, 4);
  if (visible.length === 0) return null;

  return (
    <div className="mt-3 rounded-2xl border border-border/60 bg-secondary/30 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <BookMarked className="h-3 w-3" />
        Sources officielles ({visible.length})
      </div>
      <ul className="space-y-1.5">
        {visible.map((s) => (
          <li
            key={s.n}
            className="flex items-start justify-between gap-2 rounded-xl border border-border/40 bg-background/60 p-2 text-[12px]"
          >
            <div className="min-w-0 flex-1">
              <Badge variant="outline" className="mr-1.5 h-5 px-1.5 font-mono text-[10px]">
                [{s.n}]
              </Badge>
              <span className="font-medium text-foreground">
                {s.ref ? `${s.ref} — ` : ""}
                {s.title}
              </span>
            </div>
            {s.url && (
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
                title="Ouvrir la source"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
