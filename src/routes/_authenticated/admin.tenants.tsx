import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, Building2, Zap } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listAllTenants } from "@/server/tenant.functions";

export const Route = createFileRoute("/_authenticated/admin/tenants")({
  head: () => ({ meta: [{ title: "Gestion des tenants · Admin · JurisAI" }] }),
  component: AdminTenantsPage,
});

function AdminTenantsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: () => listAllTenants(),
  });

  return (
    <AppShell>
      <div className="glass-panel flex-1 overflow-auto rounded-3xl p-8">
        <div className="mx-auto max-w-6xl">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <Building2 className="h-7 w-7 text-primary" />
              <h1 className="text-2xl font-semibold">Tenants</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Vue globale des organisations clientes (super-admin uniquement).
            </p>
          </header>

          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {(error as Error).message}
            </div>
          )}

          {data && (
            <>
              <div className="mb-6 grid grid-cols-3 gap-4">
                <Stat label="Tenants" value={data.length} />
                <Stat
                  label="Membres totaux"
                  value={data.reduce((s, t) => s + t.members, 0)}
                />
                <Stat
                  label="Questions consommées"
                  value={data.reduce((s, t) => s + t.questions_used, 0)}
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Liste</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2">Nom</th>
                        <th className="px-4 py-2">Plan</th>
                        <th className="px-4 py-2">IDCC</th>
                        <th className="px-4 py-2">Membres</th>
                        <th className="px-4 py-2">Quota</th>
                        <th className="px-4 py-2">Créé</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((t) => (
                        <tr key={t.id} className="border-b border-border/50 hover:bg-secondary/40">
                          <td className="px-4 py-3">
                            <div className="font-medium">{t.name}</div>
                            <div className="text-[11px] text-muted-foreground">{t.slug}</div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="capitalize">
                              {t.plan}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{t.idcc ?? "—"}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" /> {t.members}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs tabular-nums">
                                {t.questions_used}/{t.quota_questions}
                              </span>
                              <div className="h-1 w-16 overflow-hidden rounded-full bg-foreground/10">
                                <div
                                  className={
                                    t.pct >= 100
                                      ? "h-full bg-destructive"
                                      : t.pct >= 80
                                        ? "h-full bg-yellow-500"
                                        : "h-full bg-primary"
                                  }
                                  style={{ width: `${Math.min(100, t.pct)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {new Date(t.created_at).toLocaleDateString("fr-FR")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.length === 0 && (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      Aucun tenant.
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Zap className="h-3 w-3" /> {label}
        </div>
        <div className="mt-2 text-2xl font-semibold">{value.toLocaleString("fr-FR")}</div>
      </CardContent>
    </Card>
  );
}
