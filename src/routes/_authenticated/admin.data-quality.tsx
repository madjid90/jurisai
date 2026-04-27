import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Check = {
  id: string;
  check_name: string;
  status: "pass" | "warn" | "fail";
  metric_value: number | null;
  threshold: number | null;
  details: { description?: string };
  ran_at: string;
};

export const Route = createFileRoute("/_authenticated/admin/data-quality")({
  component: DataQualityPage,
});

function DataQualityPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("data_quality_checks")
      .select("*")
      .order("ran_at", { ascending: false })
      .limit(40);
    setChecks((data ?? []) as Check[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const runNow = async () => {
    setRunning(true);
    const { error } = await supabase.rpc("run_data_quality_checks" as never);
    setRunning(false);
    if (error) toast.error("Erreur lors du contrôle");
    else { toast.success("Contrôle exécuté"); void load(); }
  };

  // Latest by check_name
  const latest = new Map<string, Check>();
  for (const c of checks) if (!latest.has(c.check_name)) latest.set(c.check_name, c);

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <ShieldCheck className="h-6 w-6 text-accent" />
              Qualité des données
            </h1>
            <p className="text-sm text-muted-foreground">Contrôles automatiques sur la base RAG.</p>
          </div>
          <Button onClick={runNow} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Exécuter
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Array.from(latest.values()).map((c) => (
              <CheckCard key={c.id} check={c} />
            ))}
            {latest.size === 0 && (
              <p className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Aucun contrôle exécuté. Cliquez sur Exécuter.
              </p>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function CheckCard({ check }: { check: Check }) {
  const Icon = check.status === "pass" ? CheckCircle2 : check.status === "warn" ? AlertTriangle : XCircle;
  const color = check.status === "pass" ? "text-emerald-500" : check.status === "warn" ? "text-amber-500" : "text-rose-500";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{check.check_name.replaceAll("_", " ")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{check.details.description}</p>
        </div>
        <Icon className={`h-5 w-5 ${color}`} />
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold">{check.metric_value}</span>
        {check.threshold !== null && (
          <span className="text-xs text-muted-foreground">/ seuil {check.threshold}</span>
        )}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        {new Date(check.ran_at).toLocaleString("fr-FR")}
      </p>
    </div>
  );
}
