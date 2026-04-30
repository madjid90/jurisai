import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertOctagon, Loader2, RefreshCw, ServerCrash } from "lucide-react";
import { listServerErrors, type ServerErrorRow } from "@/server/quality.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/server-errors")({
  component: ServerErrorsPage,
});

function ServerErrorsPage() {
  const [rows, setRows] = useState<ServerErrorRow[]>([]);
  const [topFns, setTopFns] = useState<Array<{ name: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<"" | "warn" | "error" | "critical">("");
  const [hours, setHours] = useState<number>(72);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listServerErrors({
        data: {
          severity: severity || undefined,
          sinceHours: hours,
          limit: 200,
        },
      });
      setRows(res.rows as ServerErrorRow[]);
      setTopFns(res.topFunctions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity, hours]);

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <ServerCrash className="h-6 w-6 text-rose-500" /> Erreurs serveur
            </h1>
            <p className="text-sm text-muted-foreground">
              Journal des exceptions capturées sur les server functions.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1 h-4 w-4" /> Rafraîchir
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">Toutes sévérités</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
            <option value="critical">Critical</option>
          </select>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value={24}>24h</option>
            <option value={72}>72h</option>
            <option value={168}>7 jours</option>
            <option value={720}>30 jours</option>
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4 lg:col-span-1">
            <h2 className="mb-3 text-sm font-semibold">Top fonctions en échec</h2>
            {topFns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune erreur sur la période.</p>
            ) : (
              <ul className="space-y-1">
                {topFns.map((f) => (
                  <li key={f.name} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs">{f.name}</span>
                    <Badge variant="secondary">{f.count}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold">
              {rows.length} événement{rows.length > 1 ? "s" : ""}
            </h2>
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune erreur sur la période. 🎉</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-border/50 bg-background/40 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={r.severity} />
                      <span className="font-mono text-xs">{r.function_name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("fr-FR")}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-xs text-foreground/90">{r.error_message}</p>
                    {r.error_stack && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-muted-foreground">
                          Stack
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-secondary/40 p-2 text-[10px] leading-tight">
                          {r.error_stack}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SeverityBadge({ severity }: { severity: ServerErrorRow["severity"] }) {
  if (severity === "critical")
    return (
      <Badge className="bg-rose-500/15 text-rose-600 hover:bg-rose-500/20">
        <AlertOctagon className="mr-1 h-3 w-3" /> Critical
      </Badge>
    );
  if (severity === "error")
    return <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/20">Error</Badge>;
  return <Badge variant="secondary">Warn</Badge>;
}
