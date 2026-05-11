// AnalysisView — résultat d'une analyse de document joint.
// Affiche : type doc, résumé, risques (badges sévérité), clauses manquantes,
// dates clés extraites + lien vers /analyses/:id pour le détail complet.

import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileSearch, AlertTriangle, Calendar, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AgentRun } from "../ResultRenderer";

type AnalysisShape = {
  document_type?: string;
  summary?: string;
  risks?: Array<{ title: string; severity?: "low" | "medium" | "high" | "critical"; description?: string }>;
  missing_clauses?: string[];
  key_dates?: Array<{ label: string; date: string }>;
};

const SEVERITY_TONE: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  high: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  critical: "bg-destructive/10 text-destructive",
};

export function AnalysisView({ run }: { run: AgentRun }) {
  const attachments = run.draft?.attachments ?? [];
  const firstAnalysisId = attachments.find((a) => !!a.analysis_id)?.analysis_id;
  const analysis = (run.draft?.analysis ?? {}) as AnalysisShape;
  const answer = run.answer ?? "";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileSearch className="h-3.5 w-3.5 text-primary" />
        Analyse du document {attachments[0]?.filename ? <span className="font-medium">{attachments[0].filename}</span> : null}
      </div>

      {analysis.document_type ? (
        <Badge variant="secondary" className="text-[11px]">{analysis.document_type}</Badge>
      ) : null}

      {analysis.summary ? (
        <div className="rounded-xl border border-border/60 bg-background/60 p-3">
          <p className="text-sm leading-relaxed text-foreground/90">{analysis.summary}</p>
        </div>
      ) : answer ? (
        <div className="prose prose-sm max-w-none break-words text-sm leading-relaxed text-foreground/90">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      ) : null}

      {analysis.risks && analysis.risks.length > 0 ? (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3 w-3" />
            Risques identifiés ({analysis.risks.length})
          </div>
          <ul className="space-y-1.5">
            {analysis.risks.map((r, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-border/40 bg-background/60 p-2 text-xs">
                <Badge className={SEVERITY_TONE[r.severity ?? "low"]}>{r.severity ?? "low"}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.title}</p>
                  {r.description ? <p className="text-muted-foreground">{r.description}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.missing_clauses && analysis.missing_clauses.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Clauses manquantes
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {analysis.missing_clauses.map((c, i) => (
              <li key={i} className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px]">
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.key_dates && analysis.key_dates.length > 0 ? (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Calendar className="h-3 w-3" />
            Dates clés
          </div>
          <ul className="space-y-1">
            {analysis.key_dates.map((d, i) => (
              <li key={i} className="flex items-center justify-between text-xs">
                <span>{d.label}</span>
                <span className="font-mono text-muted-foreground">{d.date}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {firstAnalysisId ? (
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to="/analyses/$id" params={{ id: firstAnalysisId }}>
            Voir l'analyse complète
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
