// LegalAnswerView — affiche une réponse juridique sourcée.
// Format : markdown rendu + bloc de sources [N] cliquables.
// Si requires_rag mais aucune source citée → on affiche un avertissement
// (mais le RefusedView gère déjà les refus durs).

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookMarked, ExternalLink, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentRun, AgentRunSource } from "../ResultRenderer";

export function LegalAnswerView({ run }: { run: AgentRun }) {
  const answer = run.answer ?? "";
  const sources = (run.sources ?? []) as AgentRunSource[];

  // Sources réellement citées via [source:N]
  const cited = new Set<number>();
  const re = /\[source:(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) cited.add(parseInt(m[1], 10));

  const visibleSources =
    cited.size > 0
      ? sources.filter((s) => cited.has(Number(s.n ?? s.index ?? 0)))
      : sources.slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Scale className="h-3.5 w-3.5 text-primary" />
        Réponse sourcée sur les sources légales officielles.
      </div>

      <div className="prose prose-sm max-w-none break-words text-sm leading-relaxed text-foreground/90">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer || "_Aucun contenu._"}</ReactMarkdown>
      </div>

      {visibleSources.length > 0 ? (
        <div className="rounded-xl border border-border/60 bg-secondary/30 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <BookMarked className="h-3 w-3" />
            Sources officielles ({visibleSources.length})
          </div>
          <ul className="space-y-1.5">
            {visibleSources.map((s) => {
              const n = Number(s.n ?? s.index ?? 0);
              const ref = s.ref ?? s.reference ?? null;
              return (
                <li
                  key={`${n}-${s.title}`}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border/40 bg-background/60 p-2 text-[12px]"
                >
                  <div className="min-w-0 flex-1">
                    <Badge variant="outline" className="mr-1.5 h-5 px-1.5 font-mono text-[10px]">
                      [{n || "?"}]
                    </Badge>
                    <span className="font-medium text-foreground">
                      {ref ? `${ref} — ` : ""}
                      {s.title}
                    </span>
                  </div>
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                      title="Ouvrir la source"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
          Aucune source officielle citée — à recouper manuellement avant toute décision.
        </p>
      )}
    </div>
  );
}
