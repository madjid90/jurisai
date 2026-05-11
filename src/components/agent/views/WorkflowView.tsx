// WorkflowView — résultat d'une intent "conformite" / "procedure".
// Si la run a un workflow_instance_id, on propose de l'ouvrir directement
// dans l'écran procédure (qui contient WorkflowStepInline / WorkflowStatusBanner).

import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ListChecks, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      ) : (
        <p className="text-sm text-muted-foreground">
          L'agent prépare le déroulé de la procédure.
        </p>
      )}

      {wfId ? (
        <Button asChild size="sm" className="gap-1.5">
          <Link to="/workflows_/$id" params={{ id: wfId }}>
            Ouvrir la procédure
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
