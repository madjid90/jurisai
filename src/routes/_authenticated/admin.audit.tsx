import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listAuditLogs } from "@/lib/server-fns/audit.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  component: AuditPage,
});

type Row = Awaited<ReturnType<typeof listAuditLogs>>[number];

function AuditPage() {
  const fetchLogs = useServerFn(listAuditLogs);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let alive = true;
    fetchLogs({ data: { limit: 200 } })
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [fetchLogs]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const f = filter.toLowerCase();
    return rows.filter((r) =>
      r.action.toLowerCase().includes(f) ||
      (r.resource_type ?? "").toLowerCase().includes(f) ||
      (r.resource_id ?? "").toLowerCase().includes(f),
    );
  }, [rows, filter]);

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Shield className="h-7 w-7 text-primary" />
          Audit logs
        </h1>
        <p className="text-muted-foreground mt-2">
          Toutes les actions sensibles tracées automatiquement (admin uniquement).
        </p>
      </div>

      <Input
        placeholder="Filtrer par action, type ou ID…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-md"
      />

      {loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>}
      {error && <div className="text-destructive">{error}</div>}

      {!loading && !error && (
        <Card>
          <CardHeader><CardTitle>{filtered.length} entrée{filtered.length > 1 ? "s" : ""}</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2 pr-3">Ressource</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/40">
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("fr-FR")}
                      </td>
                      <td className="py-2 pr-3"><Badge variant="secondary">{r.action}</Badge></td>
                      <td className="py-2 pr-3">
                        {r.resource_type ?? "—"}
                        {r.resource_id && <span className="text-muted-foreground"> · {r.resource_id.slice(0, 8)}</span>}
                      </td>
                      <td className="py-2 pr-3">
                        {r.api_key_id ? <Badge variant="outline">API key</Badge> :
                          r.user_id ? <Badge variant="outline">User</Badge> :
                          <span className="text-muted-foreground">system</span>}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{r.ip_address ?? "—"}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Aucun log.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
