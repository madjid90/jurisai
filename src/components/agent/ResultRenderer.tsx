// ResultRenderer — composant central qui dispatch le rendu d'une agent_run
// vers une sous-vue spécialisée selon l'intent (ou l'état).
//
// Toutes les pages qui affichent un résultat agent (/agent, /chat, /mes-demandes/:id)
// utilisent ce composant : la cohérence de présentation est garantie par construction.
//
// La logique de dispatch tient en quelques règles :
//   1. refused === true                          → RefusedView
//   2. attachment / analyse de doc               → AnalysisView
//   3. intent question_juridique / recherche…    → LegalAnswerView
//   4. intent redaction_document                 → DocumentDraftView
//   5. intent conformite / procédure             → WorkflowView
//   6. routing dossier_selection (n candidats)   → DossierSelectionView
//   7. fallback                                  → FollowUpView

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LegalAnswerView } from "./views/LegalAnswerView";
import { DocumentDraftView } from "./views/DocumentDraftView";
import { WorkflowView } from "./views/WorkflowView";
import { DossierSelectionView } from "./views/DossierSelectionView";
import { AnalysisView } from "./views/AnalysisView";
import { FollowUpView } from "./views/FollowUpView";
import { RefusedView } from "./views/RefusedView";

export type AgentRunSource = {
  n?: number;
  index?: number;
  title: string;
  ref?: string | null;
  reference?: string | null;
  url?: string | null;
};

export type AgentRunSuggestedAction = {
  id?: string;
  type?: string;
  kind?: string;
  label: string;
  description?: string;
  payload?: Record<string, unknown>;
};

export type AgentRunDraft = {
  attachments?: Array<{ analysis_id?: string; filename?: string }>;
  routing?: {
    target?: string;
    candidates?: Array<{ id: string; title: string; category: string | null }>;
    mode?: string;
  } | null;
  classification?: Record<string, unknown>;
  questions?: unknown[];
  form?: unknown;
  validation?: unknown;
  analysis?: Record<string, unknown> | null;
  procedure?: Record<string, unknown> | null;
  sources?: AgentRunSource[];
  [k: string]: unknown;
};

export type AgentRun = {
  id: string;
  message: string;
  title?: string | null;
  status?: string | null;
  intent?: string | null;
  domain?: string | null;
  topic?: string | null;
  confidence?: number | null;
  answer?: string | null;
  sources?: AgentRunSource[] | null;
  suggested_actions?: AgentRunSuggestedAction[] | null;
  missing_information?: string[] | null;
  requires_validation?: boolean | null;
  refused?: boolean | null;
  refusal_reason?: string | null;
  dossier_id?: string | null;
  workflow_instance_id?: string | null;
  final_document_ids?: string[] | null;
  draft?: AgentRunDraft | null;
  created_at?: string;
  updated_at?: string;
};

export type ResultRendererProps = {
  run: AgentRun | null | undefined;
  loading?: boolean;
  dossierTitle?: string | null;
  onSuggestedAction?: (action: AgentRunSuggestedAction) => void;
  className?: string;
};

export function ResultRenderer({
  run,
  loading,
  dossierTitle,
  onSuggestedAction,
  className,
}: ResultRendererProps) {
  if (loading) {
    return (
      <section className={cn("rounded-2xl border border-border/60 bg-card p-6", className)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          L'agent prépare une réponse sourcée…
        </div>
      </section>
    );
  }

  if (!run) {
    return (
      <section className={cn("rounded-2xl border border-border/60 bg-card p-6", className)}>
        <p className="text-sm text-muted-foreground">Aucun résultat à afficher.</p>
      </section>
    );
  }

  const body = pickView(run);

  return (
    <section className={cn("space-y-3", className)}>
      {run.dossier_id ? (
        <DossierHeader dossierId={run.dossier_id} dossierTitle={dossierTitle} />
      ) : null}

      <div className="rounded-2xl border border-border/60 bg-card">
        <IntentBadge intent={run.intent} domain={run.domain} />
        <div className="p-4 sm:p-5 space-y-4">{body}</div>
      </div>

      <SharedFooter run={run} onSuggestedAction={onSuggestedAction} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
function pickView(run: AgentRun): ReactNode {
  if (run.refused) {
    return <RefusedView run={run} />;
  }

  // Cas analyse : un document a été joint (ou outil analyze_document utilisé).
  const attachments = run.draft?.attachments ?? [];
  if (attachments.length > 0 || run.intent === "analyse_document") {
    return <AnalysisView run={run} />;
  }

  // Cas dossier_selection : plusieurs dossiers candidats.
  const routing = run.draft?.routing;
  if (routing?.target === "dossier_selection" && (routing.candidates?.length ?? 0) > 1) {
    return <DossierSelectionView run={run} />;
  }

  switch (run.intent) {
    case "question_juridique":
    case "recherche_jurisprudence":
    case "veille":
      return <LegalAnswerView run={run} />;
    case "redaction_document":
      return <DocumentDraftView run={run} />;
    case "conformite":
    case "procedure":
      return <WorkflowView run={run} />;
    default:
      return <FollowUpView run={run} />;
  }
}

// ---------------------------------------------------------------------------
// Header dossier (lien vers /dossiers/:id)
// ---------------------------------------------------------------------------
function DossierHeader({
  dossierId,
  dossierTitle,
}: {
  dossierId: string;
  dossierTitle?: string | null;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <span className="text-xs text-muted-foreground">Dossier lié</span>
      <Link
        to="/dossiers/$id"
        params={{ id: dossierId }}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {dossierTitle ?? "Ouvrir le dossier 360°"}
        <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bandeau type d'intent (info contextuelle, jamais bloquant)
// ---------------------------------------------------------------------------
const INTENT_LABELS: Record<string, string> = {
  question_juridique: "Question juridique",
  recherche_jurisprudence: "Recherche jurisprudence",
  veille: "Veille",
  redaction_document: "Rédaction de document",
  conformite: "Conformité / procédure",
  procedure: "Procédure",
  analyse_document: "Analyse de document",
  gestion_dossier: "Gestion de dossier",
  suivi_echeance: "Suivi d'échéance",
  autre: "Demande",
};

function IntentBadge({
  intent,
  domain,
}: {
  intent?: string | null;
  domain?: string | null;
}) {
  const label = intent ? INTENT_LABELS[intent] ?? intent : "Réponse";
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {domain ? (
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {domain}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer partagé : actions suggérées + activité récente
// (validation_actions / timeline complète restent gérées par chaque page hôte
//  qui possède le contexte métier ; ici on affiche juste les chips suggérés.)
// ---------------------------------------------------------------------------
function SharedFooter({
  run,
  onSuggestedAction,
}: {
  run: AgentRun;
  onSuggestedAction?: (a: AgentRunSuggestedAction) => void;
}) {
  const actions = run.suggested_actions ?? [];
  if (actions.length === 0 && !run.updated_at) return null;

  return (
    <div className="space-y-3">
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((a, i) => (
            <button
              key={a.id ?? `${a.label}-${i}`}
              type="button"
              onClick={() => onSuggestedAction?.(a)}
              title={a.description}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition hover:border-primary/40 hover:bg-primary/10"
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      {run.updated_at ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          Mis à jour {new Date(run.updated_at).toLocaleString("fr-FR", {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </div>
      ) : null}
    </div>
  );
}
