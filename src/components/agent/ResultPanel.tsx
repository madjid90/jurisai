// ResultPanel — composant central unifié pour afficher un résultat agent.
// Structure : <Summary /> · <SuggestedActions /> · <ValidationActions />
// · <LinkedDocuments /> · <TimelinePreview />
//
// Ne contient PAS de logique métier : c'est un primitive de présentation
// que les pages /agent, /dashboard, /dossiers/$id branchent à leurs handlers.

import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type SuggestedActionType =
  | "open_dossier"
  | "create_dossier"
  | "link_document"
  | "start_workflow"
  | "generate_document"
  | "create_reminder"
  | "validate_action"
  | "assign_task"
  | "send_notification";

export type SuggestedAction = {
  id: string;
  type: SuggestedActionType;
  label: string;
  description?: string;
  payload?: Record<string, unknown>;
};

export type ValidationAction = {
  id: string;
  label: string;
  variant?: "default" | "destructive" | "outline";
  description?: string;
};

export type LinkedDocument = {
  id: string;
  title: string;
  href?: string;
  meta?: string;
};

export type TimelineEvent = {
  id: string;
  label: string;
  at: string;
  kind?: string;
};

export type Source = {
  index: number;
  title: string;
  reference?: string | null;
  url?: string | null;
};

export type ResultPanelProps = {
  state?: "idle" | "thinking" | "processing" | "waiting_validation" | "completed" | "error";
  summary?: string | null;
  sources?: Source[];
  suggestedActions?: SuggestedAction[];
  validationActions?: ValidationAction[];
  linkedDocuments?: LinkedDocument[];
  timeline?: TimelineEvent[];
  dossierId?: string | null;
  dossierTitle?: string | null;
  errorMessage?: string | null;
  onSuggestedAction?: (action: SuggestedAction) => void;
  onValidationAction?: (action: ValidationAction) => void;
  className?: string;
};

export function ResultPanel({
  state = "completed",
  summary,
  sources = [],
  suggestedActions = [],
  validationActions = [],
  linkedDocuments = [],
  timeline = [],
  dossierId,
  dossierTitle,
  errorMessage,
  onSuggestedAction,
  onValidationAction,
  className,
}: ResultPanelProps) {
  const isLoading = state === "thinking" || state === "processing";

  return (
    <section className={cn("rounded-2xl border border-border/60 bg-card", className)}>
      {dossierId && (
        <div className="border-b border-border/60 px-4 py-2">
          <Link
            to="/dossiers/$id"
            params={{ id: dossierId }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            📁 {dossierTitle ?? "Dossier lié"} <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      <div className="space-y-4 p-4">
        {/* Summary */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            L'agent prépare une réponse sourcée…
          </div>
        ) : state === "error" ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {errorMessage ?? "Une erreur est survenue."}
          </p>
        ) : summary ? (
          <Summary text={summary} sources={sources} />
        ) : null}

        {/* Validation actions (mises en avant si waiting_validation) */}
        {validationActions.length > 0 && (
          <ValidationBlock
            highlighted={state === "waiting_validation"}
            actions={validationActions}
            onAction={onValidationAction}
          />
        )}

        {/* Suggested actions */}
        {suggestedActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestedActions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSuggestedAction?.(a)}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-soft-foreground transition hover:border-accent/60 hover:bg-accent hover:text-accent-foreground"
                title={a.description}
              >
                <Sparkles className="h-3 w-3" />
                {a.label}
              </button>
            ))}
          </div>
        )}

        {/* Linked documents */}
        {linkedDocuments.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Documents liés
            </h4>
            <ul className="space-y-1">
              {linkedDocuments.map((d) => (
                <li key={d.id}>
                  {d.href ? (
                    <Link
                      to={d.href}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground/80 transition hover:bg-secondary hover:text-foreground"
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate">{d.title}</span>
                      {d.meta && <span className="ml-auto text-[11px] text-muted-foreground">{d.meta}</span>}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-foreground/80">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      {d.title}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Timeline preview */}
        {timeline.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Activité récente
            </h4>
            <ul className="space-y-1">
              {timeline.slice(0, 3).map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Clock className="mt-0.5 h-3 w-3 flex-shrink-0" />
                  <span className="flex-1">{e.label}</span>
                  <span className="flex-shrink-0">
                    {new Date(e.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Summary({ text, sources }: { text: string; sources: Source[] }) {
  // Render simple paragraphs + sources block. Citations [source:N] left as text.
  return (
    <div className="space-y-3">
      <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm text-foreground/90">
        {text}
      </div>
      {sources.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sources
          </p>
          <ol className="space-y-1 text-xs">
            {sources.map((s) => (
              <li key={s.index} className="flex gap-2">
                <span className="font-mono text-muted-foreground">[{s.index}]</span>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {s.title}
                    {s.reference ? ` — ${s.reference}` : ""}
                  </a>
                ) : (
                  <span>
                    {s.title}
                    {s.reference ? ` — ${s.reference}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ValidationBlock({
  actions,
  highlighted,
  onAction,
}: {
  actions: ValidationAction[];
  highlighted?: boolean;
  onAction?: (a: ValidationAction) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        highlighted ? "border-amber-500/40 bg-amber-500/5" : "border-border/60 bg-muted/30",
      )}
    >
      {highlighted && (
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Votre validation est demandée
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant={a.variant ?? "default"}
            onClick={() => onAction?.(a)}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
