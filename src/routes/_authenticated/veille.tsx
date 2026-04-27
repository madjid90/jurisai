import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Info,
  AlertOctagon,
  CheckCircle2,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listAlerts, dismissAlert } from "@/server/alerts.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/veille")({
  component: VeillePage,
});

function VeillePage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["legal-alerts"],
    queryFn: () => listAlerts(),
    refetchInterval: 60_000,
  });

  const dismiss = useMutation({
    mutationFn: (alertId: string) => dismissAlert({ data: { alertId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["legal-alerts"] }),
  });

  const active = data?.filter((a) => !a.dismissed) ?? [];
  const archived = data?.filter((a) => a.dismissed) ?? [];

  return (
    <AppShell>
      <div className="glass-panel flex-1 overflow-auto rounded-3xl p-8">
        <div className="mx-auto max-w-4xl">
          <header className="mb-8 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <Bell className="h-7 w-7 text-primary" />
                <h1 className="text-2xl font-semibold">Veille juridique</h1>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Nouvelles sources et mises à jour du droit du travail.
              </p>
            </div>
            {active.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {active.length} non lue{active.length > 1 ? "s" : ""}
              </Badge>
            )}
          </header>

          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </div>
          )}

          {!isLoading && active.length === 0 && archived.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Aucune alerte pour le moment. Nous vous préviendrons dès qu'une nouvelle source sera ajoutée.
                </p>
              </CardContent>
            </Card>
          )}

          {active.length > 0 && (
            <section className="mb-8 space-y-3">
              {active.map((a) => (
                <AlertCard
                  key={a.id}
                  alert={a}
                  onDismiss={() => dismiss.mutate(a.id)}
                  busy={dismiss.isPending}
                />
              ))}
            </section>
          )}

          {archived.length > 0 && (
            <section>
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Lues
              </h2>
              <div className="space-y-2 opacity-60">
                {archived.slice(0, 20).map((a) => (
                  <AlertCard key={a.id} alert={a} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function AlertCard({
  alert,
  onDismiss,
  busy,
}: {
  alert: {
    id: string;
    title: string;
    summary: string | null;
    severity: "info" | "warning" | "critical";
    change_type: string;
    idcc: string | null;
    source_type: string | null;
    official_url: string | null;
    legal_date: string | null;
    created_at: string;
    dismissed: boolean;
  };
  onDismiss?: () => void;
  busy?: boolean;
}) {
  const Icon =
    alert.severity === "critical" ? AlertOctagon : alert.severity === "warning" ? AlertTriangle : Info;

  const tone =
    alert.severity === "critical"
      ? "border-destructive/30 bg-destructive/5"
      : alert.severity === "warning"
        ? "border-yellow-500/30 bg-yellow-500/5"
        : "border-border";

  return (
    <Card className={cn("transition", tone)}>
      <CardHeader className="flex-row items-start gap-3 space-y-0 pb-2">
        <Icon
          className={cn(
            "mt-0.5 h-5 w-5 flex-shrink-0",
            alert.severity === "critical"
              ? "text-destructive"
              : alert.severity === "warning"
                ? "text-yellow-600"
                : "text-primary",
          )}
        />
        <div className="flex-1 min-w-0">
          <CardTitle className="text-[14px] leading-snug">{alert.title}</CardTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="text-[10px] capitalize">
              {alert.change_type === "new" ? "Nouveau" : alert.change_type === "updated" ? "Mise à jour" : "Abrogé"}
            </Badge>
            {alert.source_type && (
              <Badge variant="outline" className="text-[10px] capitalize">
                {alert.source_type}
              </Badge>
            )}
            {alert.idcc && <span className="font-mono">IDCC {alert.idcc}</span>}
            <span>{new Date(alert.created_at).toLocaleDateString("fr-FR")}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {alert.summary && <p className="text-[13px] text-foreground/80">{alert.summary}</p>}
        <div className="mt-3 flex items-center gap-2">
          {alert.official_url && (
            <a
              href={alert.official_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Source officielle
            </a>
          )}
          <div className="flex-1" />
          {!alert.dismissed && onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>
              Marquer comme lu
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
