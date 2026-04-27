import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Activity, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

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
  const [loading, setLoading] = useState(true);
  const [newQuestion, setNewQuestion] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("rag_eval_cases").select("*").order("created_at", { ascending: false }),
      supabase.from("rag_eval_runs").select("*").order("ran_at", { ascending: false }).limit(50),
    ]);
    setCases((c ?? []) as EvalCase[]);
    setRuns((r ?? []) as EvalRun[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const addCase = async () => {
    if (!newQuestion.trim()) return;
    const { error } = await supabase.from("rag_eval_cases").insert({ question: newQuestion });
    if (error) toast.error("Erreur"); else { setNewQuestion(""); void load(); toast.success("Cas ajouté"); }
  };

  const avgP5 = runs.length ? runs.reduce((s, r) => s + (r.precision_at_5 ?? 0), 0) / runs.length : 0;
  const avgMRR = runs.length ? runs.reduce((s, r) => s + (r.mrr ?? 0), 0) / runs.length : 0;
  const halluRate = runs.length ? runs.filter((r) => r.hallucination_detected).length / runs.length : 0;

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Activity className="h-6 w-6 text-accent" /> Évaluation RAG
          </h1>
          <p className="text-sm text-muted-foreground">Set d'évaluation et résultats des runs.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Précision @5" value={(avgP5 * 100).toFixed(1) + "%"} />
          <Stat label="MRR moyen" value={avgMRR.toFixed(3)} />
          <Stat label="Taux hallucination" value={(halluRate * 100).toFixed(1) + "%"} tone={halluRate > 0.05 ? "bad" : "good"} />
        </div>

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
