import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, BarChart3, Users, Activity } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantUsage, getTenantQuota } from "@/server/tenant.functions";

export const Route = createFileRoute("/_authenticated/admin/usage")({
  component: AdminUsagePage,
});

function AdminUsagePage() {
  const { data: usage, isLoading } = useQuery({
    queryKey: ["tenant-usage"],
    queryFn: () => getTenantUsage(),
  });
  const { data: quota } = useQuery({
    queryKey: ["tenant-quota-page"],
    queryFn: () => getTenantQuota(),
  });

  const maxDay = usage ? Math.max(1, ...usage.byDay.map((d) => d.count)) : 1;

  return (
    <AppShell>
      <div className="glass-panel flex-1 overflow-auto rounded-3xl p-8">
        <div className="mx-auto max-w-5xl">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-7 w-7 text-primary" />
              <h1 className="text-2xl font-semibold">Usage de l'équipe</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Activité IA des 30 derniers jours.
            </p>
          </header>

          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </div>
          )}

          {usage && (
            <>
              <div className="mb-6 grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-[11px] uppercase text-muted-foreground">Total 30j</div>
                    <div className="mt-1 text-2xl font-semibold">{usage.total}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-[11px] uppercase text-muted-foreground">Quota mois</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums">
                      {quota ? `${quota.used}/${quota.quota}` : "—"}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-[11px] uppercase text-muted-foreground">Plan</div>
                    <div className="mt-1 text-2xl font-semibold capitalize">
                      {quota?.plan ?? "—"}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-4 w-4" /> Activité quotidienne
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex h-40 items-end gap-1">
                    {usage.byDay.length === 0 && (
                      <div className="w-full text-center text-sm text-muted-foreground">
                        Aucune activité.
                      </div>
                    )}
                    {usage.byDay.map((d) => (
                      <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t bg-primary/80 transition hover:bg-primary"
                          style={{ height: `${(d.count / maxDay) * 100}%` }}
                          title={`${d.date}: ${d.count}`}
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4" /> Top utilisateurs
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <tbody>
                      {usage.byUser.map((u) => (
                        <tr key={u.userId} className="border-b border-border/50">
                          <td className="px-4 py-2">{u.name}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                            {u.count}
                          </td>
                        </tr>
                      ))}
                      {usage.byUser.length === 0 && (
                        <tr>
                          <td className="px-4 py-4 text-center text-sm text-muted-foreground">
                            Aucun utilisateur actif.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
