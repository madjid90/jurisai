// /mes-demandes/$id — page détail unifiée d'une agent_run.
// Charge la run via getAgentRun() et délègue tout le rendu à ResultRenderer.
// Devient l'historique : l'utilisateur peut rouvrir n'importe quelle demande
// et revoir le résultat correctement formaté selon son intent.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { ResultRenderer, type AgentRun } from "@/components/agent/ResultRenderer";
import { getAgentRun } from "@/server/agent-runs.functions";
import { useExecuteSuggestedAction } from "@/hooks/use-execute-suggested-action";

export const Route = createFileRoute("/_authenticated/mes-demandes/$id")({
  head: () => ({
    meta: [
      { title: "Demande — JurisAI" },
      { name: "description", content: "Détail d'une demande à l'assistant juridique." },
    ],
  }),
  component: DemandeDetailPage,
});

function DemandeDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const get = useServerFn(getAgentRun);

  const { data, isLoading, error } = useQuery({
    queryKey: ["agent-run", id],
    queryFn: () => get({ data: { id } }),
    refetchInterval: (q) => {
      const status = (q.state.data as AgentRun | undefined)?.status;
      // Continue de poller tant que la run n'est pas finalisée.
      if (!status) return 4000;
      if (["pending", "running", "ready"].includes(status)) return 4000;
      return false;
    },
  });

  const run = data as AgentRun | undefined;

  return (
    <AppShell>
      <div className="container mx-auto max-w-4xl px-4 py-6 sm:py-10 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <Link to="/mes-demandes">
              <ArrowLeft className="h-3.5 w-3.5" />
              Retour à mes demandes
            </Link>
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => void navigate({ to: "/agent" })}>
            <Sparkles className="h-3.5 w-3.5" />
            Nouvelle demande
          </Button>
        </div>

        {run?.message ? (
          <header className="rounded-2xl border border-border/60 bg-secondary/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Votre demande
            </p>
            <p className="mt-1 text-sm text-foreground/90">{run.title || run.message}</p>
            {run.title && run.title !== run.message ? (
              <p className="mt-2 text-xs text-muted-foreground">{run.message}</p>
            ) : null}
          </header>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {(error as Error).message}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Chargement de la demande…
          </div>
        ) : (
          <ResultRenderer run={run ?? null} />
        )}
      </div>
    </AppShell>
  );
}
