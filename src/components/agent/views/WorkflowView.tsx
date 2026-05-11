// WorkflowView — résultat d'une intent "conformite" / "procedure".
// Si la run a un workflow_instance_id, on embarque directement le runtime
// (WorkflowRuntimeBlock) afin que l'utilisateur puisse exécuter sa procédure
// sans quitter /chat ou /mes-demandes/$id. Un lien optionnel renvoie vers la
// page workflow dédiée pour une vue plein écran.

import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ListChecks, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowRuntimeBlock } from "../WorkflowRuntimeBlock";
import type { AgentRun } from "../ResultRenderer";

export function WorkflowView({ run }: { run: AgentRun }) {
  const wfId = run.workflow_instance_id;
  const answer = run.answer ?? "";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5 text-primary" />
        Procédure structurée étape par étape.
      </div>

      {answer ? (
        <div className="prose prose-sm max-w-none break-words text-sm leading-relaxed text-foreground/90">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      ) : !wfId ? (
        <p className="text-sm text-muted-foreground">
          L'agent prépare le déroulé de la procédure.
        </p>
      ) : null}

      {wfId ? (
        <>
          <WorkflowRuntimeBlock instanceId={wfId} />
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/workflows_/$id" params={{ id: wfId }}>
              Vue détaillée
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </>
      ) : null}
    </div>
  );
}
