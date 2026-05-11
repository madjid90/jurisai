// Page /chat — interface conversationnelle type ChatGPT branchée sur l'agent
// juridique RAG. Chaque réponse est sourcée via [source:N] depuis legal_chunks.
// P0.1 / P1.5 : si /chat?run=ID, on charge la run existante (créée depuis la
// home) au lieu de relancer l'agent.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import { z } from "zod";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ResultRenderer, type AgentRun } from "@/components/agent/ResultRenderer";
import { runLegalAgent } from "@/server/agent.functions";
import { getAgentRun } from "@/server/agent-runs.functions";
import { useExecuteSuggestedAction } from "@/hooks/use-execute-suggested-action";
import { toast } from "sonner";

const ChatSearch = z.object({ run: z.string().uuid().optional() });

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "Chat juridique · JurisAI" }] }),
  validateSearch: (s) => ChatSearch.parse(s),
  component: ChatPage,
});

type Source = { n: number; title: string; ref: string | null; url: string | null };

type Msg =
  | { role: "user"; content: string; id: string }
  | {
      role: "assistant";
      content: string;
      id: string;
      run?: AgentRun;
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
  const fetchRun = useServerFn(getAgentRun);
  const { run: runIdParam } = Route.useSearch();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // P0.1 / P1.5 — si /chat?run=ID, charger la run existante (créée depuis la home).
  useEffect(() => {
    if (!runIdParam) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = (await fetchRun({ data: { id: runIdParam } })) as {
          id: string;
          message: string;
          intent: string | null;
          domain: string | null;
          answer: string | null;
          sources: unknown;
          suggested_actions: unknown;
          missing_information: unknown;
          requires_validation: boolean | null;
          refused: boolean | null;
          refusal_reason: string | null;
        };
        if (cancelled) return;
        const userMsg: Msg = { role: "user", content: row.message, id: `${row.id}-q` };
        const assistantMsg: Msg = {
          role: "assistant",
          content: row.answer ?? "",
          id: row.id,
          pending: !row.answer,
          run: {
            id: row.id,
            message: row.message,
            intent: row.intent ?? undefined,
            domain: row.domain ?? undefined,
            answer: row.answer ?? "",
            sources: (row.sources as AgentRun["sources"]) ?? [],
            suggested_actions: (row.suggested_actions as AgentRun["suggested_actions"]) ?? [],
            missing_information: (row.missing_information as string[]) ?? [],
            requires_validation: row.requires_validation ?? false,
            refused: row.refused ?? false,
            refusal_reason: row.refusal_reason,
          },
        };
        setMessages([userMsg, assistantMsg]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Demande introuvable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runIdParam, fetchRun]);

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
        run_id: string;
        intent: string;
        domain: string;
        answer: string;
        sources: Source[];
        suggested_actions: Array<{ kind: string; label: string }>;
        missing_information: string[];
        requires_validation: boolean;
        refused: boolean;
        refusal_reason: string | null;
      };
      const run: AgentRun = {
        id: res.run_id,
        message: q,
        intent: res.intent,
        domain: res.domain,
        answer: res.answer,
        sources: res.sources as unknown as AgentRun["sources"],
        suggested_actions: res.suggested_actions as unknown as AgentRun["suggested_actions"],
        missing_information: res.missing_information,
        requires_validation: res.requires_validation,
        refused: res.refused,
        refusal_reason: res.refusal_reason,
      };
      setMessages((m) =>
        m.map((msg) =>
          msg.id === placeholder.id
            ? { ...msg, content: res.answer, run, pending: false }
            : msg,
        ),
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Erreur inconnue";
      toast.error(errMsg);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === placeholder.id
            ? {
                ...msg,
                content: `⚠️ ${errMsg}`,
                pending: false,
                run: {
                  id: crypto.randomUUID(),
                  message: q,
                  refused: true,
                  refusal_reason: errMsg,
                },
              }
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
          <ResultRenderer run={msg.run ?? null} />
        )}
      </div>
    </div>
  );
}

