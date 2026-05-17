import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { checkServiceRoleKey } from "@/server/diagnostics.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/diagnostics")({
  head: () => ({ meta: [{ title: "Diagnostics · Admin · JurisAI" }] }),
  component: DiagnosticsPage,
});

type Result = Awaited<ReturnType<typeof checkServiceRoleKey>>;

function DiagnosticsPage() {
  const run = useServerFn(checkServiceRoleKey);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    run({})
      .then((r) => alive && setData(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [run]);

  const ok = data?.verdict === "OK";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        {ok ? (
          <ShieldCheck className="w-6 h-6 text-green-600" />
        ) : (
          <ShieldAlert className="w-6 h-6 text-amber-600" />
        )}
        <h1 className="text-2xl font-bold">Diagnostic — SERVICE_ROLE_KEY</h1>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Vérification en cours…
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Verdict
                <Badge variant={ok ? "default" : "destructive"}>{data.verdict}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div><span className="font-medium">Source utilisée :</span> {data.used_source}</div>
              <div><span className="font-medium">Ref attendu :</span> {data.expected_ref}</div>
              <div><span className="font-medium">URL Supabase :</span> {data.supabase_url}</div>
              <div>
                <span className="font-medium">Ping admin :</span>{" "}
                {data.connectivity_ping.ok ? (
                  <Badge>OK ({data.connectivity_ping.count ?? "?"} profiles)</Badge>
                ) : (
                  <Badge variant="destructive">KO — {data.connectivity_ping.error}</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Détail brut (JSON)</CardTitle></CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-3 rounded overflow-auto">
                {JSON.stringify(data, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
