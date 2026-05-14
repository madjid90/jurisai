import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Activity, Loader2, Plus, Play } from "lucide-react";
import { toast } from "sonner";
import { getRagEvalAggregate, type RagEvalAggregate } from "@/lib/server-fns/quality.functions";

type EvalCase = {
  id: string;
  question: string;
  category: string;
  difficulty: string;
  active: boolean;
};
type EvalRun = {
  id: string;
  case_id: string;
  precision_at_5: number | null;
  mrr: number | null;
  hallucination_detected: boolean | null;
  latency_ms: number | null;
  ran_at: string;
};

export const Route = createFileRoute("/_authenticated/admin/rag-quality")({
  component: RagQualityPage,
});

function RagQualityPage() {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [agg, setAgg] = useState<RagEvalAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: c }, { data: r }, a] = await Promise.all([
      supabase.from("rag_eval_cases").select("*").order("created_at", { ascending: false }),
      supabase.from("rag_eval_runs").select("*").order("ran_at", { ascending: false }).limit(50),
      getRagEvalAggregate().catch(() => null),
    ]);
    setCases((c ?? []) as EvalCase[]);
    setRuns((r ?? []) as EvalRun[]);
    setAgg(a);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const addCase = async () => {
    if (!newQuestion.trim()) return;
    const { error } = await supabase.from("rag_eval_cases").insert({ question: newQuestion });
    if (error) toast.error("Erreur"); else { setNewQuestion(""); void load(); toast.success("Cas ajouté"); }
  };

  const runEvaluation = async () => {
    setRunning(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.error("Session expirée");
        return;
      }
      const { data, error } = await supabase.functions.invoke("evaluate-rag", {
        body: { limit: 50 },
      });
      if (error) throw error;
      const queued = (data as { queued?: number; ran?: number } | null)?.queued ?? 0;
      toast.success(`Évaluation lancée en arrière-plan : ${queued} cas. Rafraîchissez dans 1-2 min.`);
      setTimeout(() => void load(), 90_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'évaluation");
    } finally {
      setRunning(false);
    }
  };

  const avgP5 = runs.length ? runs.reduce((s, r) => s + (r.precision_at_5 ?? 0), 0) / runs.length : 0;
  const avgMRR = runs.length ? runs.reduce((s, r) => s + (r.mrr ?? 0), 0) / runs.length : 0;
  const halluRate = runs.length ? runs.filter((r) => r.hallucination_detected).length / runs.length : 0;

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Activity className="h-6 w-6 text-accent" /> Évaluation RAG
            </h1>
            <p className="text-sm text-muted-foreground">Set d'évaluation et résultats des runs.</p>
          </div>
          <Button onClick={runEvaluation} disabled={running || cases.length === 0}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {running ? "Évaluation en cours…" : "Lancer une évaluation"}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Précision @5" value={(avgP5 * 100).toFixed(1) + "%"} />
          <Stat label="MRR moyen" value={avgMRR.toFixed(3)} />
          <Stat label="Taux hallucination" value={(halluRate * 100).toFixed(1) + "%"} tone={halluRate > 0.05 ? "bad" : "good"} />
        </div>

        {agg && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Métriques avancées (200 derniers runs)</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Mini label="Retrieval acc." value={pct(agg.avg_retrieval_accuracy)} />
              <Mini label="Citation cov." value={pct(agg.avg_citation_coverage)} />
              <Mini label="Answer correct." value={pct(agg.avg_answer_correctness)} />
              <Mini label="Source authority" value={agg.avg_source_authority !== null ? agg.avg_source_authority.toFixed(2) : "—"} />
              <Mini label="Refusal quality" value={pct(agg.avg_refusal_quality)} />
              <Mini label="User feedback" value={pct(agg.avg_user_feedback)} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Latence moyenne: {Math.round(agg.avg_latency_ms)} ms · {agg.total_runs} runs</p>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Ajouter un cas d'évaluation</h2>
          <div className="flex gap-2">
            <input
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              placeholder="Quelle est la durée maximale d'une période d'essai en CDI ?"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <Button onClick={addCase}><Plus className="mr-1 h-4 w-4" />Ajouter</Button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Cas d'évaluation ({cases.length})</h2>
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <ul className="space-y-2">
              {cases.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-lg border border-border/50 p-2 text-sm">
                  <span className="rounded bg-secondary px-2 py-0.5 text-[10px] uppercase">{c.difficulty}</span>
                  <span className="flex-1 truncate">{c.question}</span>
                </li>
              ))}
              {cases.length === 0 && <p className="text-sm text-muted-foreground">Aucun cas pour le moment.</p>}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  const color = tone === "good" ? "text-emerald-500" : tone === "bad" ? "text-rose-500" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

function pct(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return (v * 100).toFixed(1) + "%";
}
