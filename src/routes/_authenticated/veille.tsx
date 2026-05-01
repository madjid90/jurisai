import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Info,
  AlertOctagon,
  CheckCircle2,
  Scale,
  Calendar,
  Briefcase,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listAlerts,
  dismissAlert,
  getAlertSubscription,
  updateAlertSubscription,
} from "@/server/alerts.functions";
import { Settings2 } from "lucide-react";
import {
  listLegalUpdates,
  createLegalUpdateAction,
  updateLegalUpdateActionStatus,
} from "@/server/legal-updates.functions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/veille")({
  component: VeillePage,
});

function VeillePage() {
  return (
    <AppShell>
      <div className="glass-panel flex-1 overflow-auto rounded-3xl p-8">
        <div className="mx-auto max-w-5xl">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <Bell className="h-7 w-7 text-primary" />
              <h1 className="text-2xl font-semibold">Veille juridique</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Alertes système et mises à jour réglementaires (RGPD, fiscal, social, commercial, sociétés…).
            </p>
          </header>

          <Tabs defaultValue="updates" className="space-y-6">
            <TabsList>
              <TabsTrigger value="updates">Mises à jour réglementaires</TabsTrigger>
              <TabsTrigger value="alerts">Alertes système</TabsTrigger>
              <TabsTrigger value="subscription">
                <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                Mes abonnements
              </TabsTrigger>
            </TabsList>
            <TabsContent value="updates">
              <LegalUpdatesPanel />
            </TabsContent>
            <TabsContent value="alerts">
              <AlertsPanel />
            </TabsContent>
            <TabsContent value="subscription">
              <SubscriptionPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  );
}

// ─── Mises à jour réglementaires ─────────────────────────────────────────────

function LegalUpdatesPanel() {
  const qc = useQueryClient();
  const [domain, setDomain] = useState<string>("");
  const { data, isLoading } = useQuery({
    queryKey: ["legal-updates", domain],
    queryFn: () => listLegalUpdates({ data: { domain: domain || undefined, limit: 50 } }),
  });

  const createAction = useMutation({
    mutationFn: (input: { legalUpdateId: string; actionType: "review" | "ignore" }) =>
      createLegalUpdateAction({ data: input }),
    onSuccess: () => {
      toast.success("Action enregistrée");
      qc.invalidateQueries({ queryKey: ["legal-updates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: (input: { actionId: string; status: "completed" | "in_progress" | "cancelled" }) =>
      updateLegalUpdateActionStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["legal-updates"] }),
  });

  const domains = ["", "rgpd", "social", "commercial", "fiscal", "societes", "contentieux"];
  const domainLabels: Record<string, string> = {
    "": "Tous",
    rgpd: "RGPD",
    social: "Social",
    commercial: "Commercial",
    fiscal: "Fiscal",
    societes: "Sociétés",
    contentieux: "Contentieux",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {domains.map((d) => (
          <button
            key={d || "all"}
            onClick={() => setDomain(d)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition",
              domain === d
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-secondary",
            )}
          >
            {domainLabels[d]}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      )}

      {!isLoading && (data?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Scale className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              Aucune mise à jour réglementaire pour ce domaine.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {(data ?? []).map((u: any) => (
          <LegalUpdateCard
            key={u.id}
            update={u}
            onIgnore={() =>
              createAction.mutate({ legalUpdateId: u.id, actionType: "ignore" })
            }
            onReview={() =>
              createAction.mutate({ legalUpdateId: u.id, actionType: "review" })
            }
            onComplete={(actionId) => updateStatus.mutate({ actionId, status: "completed" })}
            busy={createAction.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function LegalUpdateCard({
  update,
  onIgnore,
  onReview,
  busy,
}: {
  update: any;
  onIgnore: () => void;
  onReview: () => void;
  onComplete: (actionId: string) => void;
  busy: boolean;
}) {
  const urgencyColor =
    update.urgency === "critical"
      ? "bg-destructive text-destructive-foreground"
      : update.urgency === "high"
        ? "bg-yellow-500 text-white"
        : "bg-muted text-muted-foreground";

  const hasAction = (update.tenant_actions ?? []).length > 0;
  const ignored = (update.tenant_actions ?? []).some((a: any) => a.action_type === "ignore");

  return (
    <Card className={cn(ignored && "opacity-60")}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px] capitalize">
                {update.domain}
              </Badge>
              <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold", urgencyColor)}>
                {update.urgency}
              </span>
              {update.effective_date && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  Effet le {new Date(update.effective_date).toLocaleDateString("fr-FR")}
                </span>
              )}
            </div>
            <CardTitle className="text-[15px] leading-snug">{update.title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <p className="text-[13px] text-foreground/80">{update.summary}</p>

        {update.who_is_concerned && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-[12px]">
            <p className="mb-1 flex items-center gap-1 font-semibold text-foreground">
              <Briefcase className="h-3 w-3" /> Qui est concerné
            </p>
            <p className="text-muted-foreground">{update.who_is_concerned}</p>
          </div>
        )}

        {update.practical_impact && (
          <div className="text-[12px]">
            <p className="font-semibold text-foreground">Impact pratique</p>
            <p className="text-muted-foreground">{update.practical_impact}</p>
          </div>
        )}

        {Array.isArray(update.recommended_actions) && update.recommended_actions.length > 0 && (
          <div className="text-[12px]">
            <p className="font-semibold text-foreground">Actions recommandées</p>
            <ul className="ml-4 list-disc text-muted-foreground">
              {update.recommended_actions.map((a: any, i: number) => (
                <li key={i}>{typeof a === "string" ? a : a.label ?? JSON.stringify(a)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {update.source_url && (
            <a
              href={update.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Source officielle
            </a>
          )}
          <div className="flex-1" />
          {hasAction ? (
            <Badge variant="outline" className="text-[10px]">
              {ignored ? "Ignorée" : "Action en cours"}
            </Badge>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onIgnore} disabled={busy}>
                Ignorer
              </Button>
              <Button size="sm" onClick={onReview} disabled={busy}>
                Marquer à traiter
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Alertes système (existant) ──────────────────────────────────────────────

function AlertsPanel() {
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

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
      </div>
    );
  }

  if (active.length === 0 && archived.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">Aucune alerte pour le moment.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {active.length > 0 && (
        <section className="mb-8 space-y-3">
          {active.map((a) => (
            <AlertCard key={a.id} alert={a} onDismiss={() => dismiss.mutate(a.id)} busy={dismiss.isPending} />
          ))}
        </section>
      )}
      {archived.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lues</h2>
          <div className="space-y-2 opacity-60">
            {archived.slice(0, 20).map((a) => (
              <AlertCard key={a.id} alert={a} />
            ))}
          </div>
        </section>
      )}
    </>
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
