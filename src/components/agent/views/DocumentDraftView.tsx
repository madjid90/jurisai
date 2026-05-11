// DocumentDraftView — résultat d'une intent "redaction_document".
// Affiche : aperçu de la réponse / brouillon + champs manquants en chips
// + actions (Compléter, Demander validation, Voir le document généré).

import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FilePen, AlertTriangle, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentRun } from "../ResultRenderer";

export function DocumentDraftView({ run }: { run: AgentRun }) {
  const missing = run.missing_information ?? [];
  const docIds = run.final_document_ids ?? [];
  const requiresValidation = !!run.requires_validation;
  const draft = run.answer ?? "";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FilePen className="h-3.5 w-3.5 text-primary" />
        Brouillon préparé par l'agent — à compléter, valider et exporter.
      </div>

      {missing.length > 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            Informations manquantes ({missing.length})
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {missing.map((info, i) => (
              <li
                key={`${info}-${i}`}
                className="rounded-full border border-amber-500/40 bg-background px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-200"
              >
                {info}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft ? (
        <div className="rounded-xl border border-border/60 bg-background/60 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Aperçu du document
          </div>
          <div className="prose prose-sm max-w-none break-words text-sm leading-relaxed text-foreground/90">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          La rédaction n'est pas encore prête — l'agent attend vos précisions.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {docIds.length > 0 ? (
          docIds.map((id) => (
            <Button asChild key={id} size="sm" variant="default">
              <Link to="/documents/$id" params={{ id }}>
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Ouvrir le document
              </Link>
            </Button>
          ))
        ) : null}
        {requiresValidation ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/5 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Validation hiérarchique requise
          </span>
        ) : null}
      </div>
    </div>
  );
}
