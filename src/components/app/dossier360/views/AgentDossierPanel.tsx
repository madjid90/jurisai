// G6 — AgentDossierPanel extrait de Dossier360Tabs.
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { runLegalAgent } from "@/lib/agent/agent.functions";

export function AgentDossierPanel({ dossierId, onActed }: { dossierId: string; onActed: () => void }) {
  const runFn = useServerFn(runLegalAgent);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [exchange, setExchange] = useState<{
    answer: string;
    sources: Array<{ n: number; title: string; ref: string | null; url: string | null }>;
    intent: { intent: string; domain: string; confidence: number } | null;
    trace: Array<{ tool: string }>;
  } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      const res = await runFn({ data: { message: input.trim(), dossier_id: dossierId } });
      setExchange({
        answer: res.answer,
        sources: res.sources,
        intent: { intent: res.intent, domain: res.domain, confidence: res.confidence },
        trace: res.trace.map((t) => ({ tool: t.tool })),
      });
      setInput("");
      onActed();
    } catch (e2) {
      toast.error(e2 instanceof Error ? e2.message : "Erreur agent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
        <div className="text-[12px] text-foreground">
          <p className="font-semibold">Agent contextuel</p>
          <p className="mt-0.5 text-muted-foreground">
            L'agent connaît ce dossier. Il peut sourcer, identifier des risques, créer des tâches, demander des validations, programmer des rappels.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          placeholder="Ex : Identifie les risques juridiques de ce dossier et propose un plan d'action."
          disabled={busy}
          className="w-full rounded-xl border border-border bg-background p-3 text-[13px] outline-none focus:border-accent disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-br from-primary to-accent px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? "L'agent réfléchit…" : "Demander à l'agent"}
        </button>
      </form>

      {exchange && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-background p-4">
          {exchange.intent && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-muted-foreground">
                intention : <strong>{exchange.intent.intent}</strong>
              </span>
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-muted-foreground">
                domaine : <strong>{exchange.intent.domain}</strong>
              </span>
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-muted-foreground">
                confiance : <strong>{Math.round(exchange.intent.confidence * 100)}%</strong>
              </span>
            </div>
          )}
          <div className="prose prose-sm max-w-none text-[13px] text-foreground whitespace-pre-wrap">
            {exchange.answer}
          </div>
          {exchange.sources.length > 0 && (
            <div className="border-t border-border pt-2">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Sources</p>
              <ul className="mt-1.5 space-y-1">
                {exchange.sources.map((s) => (
                  <li key={s.n} className="text-[11.5px]">
                    <span className="font-mono text-accent">[{s.n}]</span>{" "}
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                        {s.title}
                      </a>
                    ) : (
                      <span>{s.title}</span>
                    )}
                    {s.ref && <span className="text-muted-foreground"> · {s.ref}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {exchange.trace.length > 0 && (
            <p className="text-[10.5px] text-muted-foreground">
              Outils utilisés : {exchange.trace.map((t) => t.tool).join(" → ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
