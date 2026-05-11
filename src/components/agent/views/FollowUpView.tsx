// FollowUpView — vue par défaut pour les intents "suivi" / "autre" / fallback.
// Affiche la réponse markdown + un récap minimal et propose les liens vers
// les ressources créées (dossier, documents).

import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessageSquare, FileText } from "lucide-react";
import type { AgentRun } from "../ResultRenderer";

export function FollowUpView({ run }: { run: AgentRun }) {
  const answer = run.answer ?? "";
  const docIds = run.final_document_ids ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5 text-primary" />
        Réponse de l'agent.
      </div>

      {answer ? (
        <div className="prose prose-sm max-w-none break-words text-sm leading-relaxed text-foreground/90">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">L'agent prépare une réponse…</p>
      )}

      {docIds.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Documents générés
          </div>
          <ul className="space-y-1">
            {docIds.map((id) => (
              <li key={id}>
                <Link
                  to="/documents/$id"
                  params={{ id }}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Ouvrir le document
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
