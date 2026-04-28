import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ArrowLeft, CheckCircle2, Circle, ExternalLink, BookOpen, FileText, Sparkles } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import {
  getWorkflowInstance,
  completeWorkflowStep,
  generateDocFromWorkflowStep,
  getTemplateBySlug,
} from "@/server/workflows.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/workflows_/$id")({
  head: () => ({ meta: [{ title: "Procédure · JurisAI" }] }),
  component: WorkflowDetailPage,
});

type StepDef = {
  key: string;
  title: string;
  description?: string;
  type?: string;
  legal_refs?: string[];
  delay_days?: number;
};

type StepRun = {
  id: string;
  step_index: number;
  step_key: string;
  status: string;
  notes: string | null;
  executed_at: string | null;
};

function WorkflowDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const get = useServerFn(getWorkflowInstance);
  const complete = useServerFn(completeWorkflowStep);

  const [data, setData] = useState<{ instance: any; runs: StepRun[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [notes, setNotes] = useState("");

  const reload = async () => {
    try {
      const r = await get({ data: { instanceId: id } });
      setData(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !data) {
    return (
      <AppShell>
        <div className="flex h-60 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      </AppShell>
    );
  }

  const inst = data.instance;
  const def = inst.workflow_definitions;
  const steps: StepDef[] = (def?.steps ?? []) as StepDef[];
  const currentIdx = inst.current_step_index ?? 0;
  const isComplete = inst.status === "completed";
  const currentStep = steps[currentIdx];

  const runByIdx = new Map(data.runs.map((r) => [r.step_index, r]));

  const handleComplete = async () => {
    if (!currentStep) return;
    setAdvancing(true);
    try {
      const res = await complete({
        data: {
          instanceId: id,
          stepIndex: currentIdx,
          stepKey: currentStep.key,
          notes: notes.trim() || undefined,
        },
      });
      setNotes("");
      toast.success(res.completed ? "Procédure terminée 🎉" : "Étape validée");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6">
        <button
          type="button"
          onClick={() => void navigate({ to: "/workflows" })}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Procédures
        </button>

        <header className="glass-panel rounded-3xl p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-[24px] font-bold tracking-tight">{inst.title}</h1>
              {def?.description && (
                <p className="mt-1.5 text-[13px] text-muted-foreground">{def.description}</p>
              )}
            </div>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                isComplete
                  ? "bg-emerald-500/15 text-emerald-600"
                  : inst.status === "cancelled"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-accent-soft text-accent",
              )}
            >
              {inst.status}
            </span>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent transition-all"
                style={{ width: `${steps.length ? (currentIdx / steps.length) * 100 : 0}%` }}
              />
            </div>
            <span className="text-[12px] font-medium text-muted-foreground">
              {currentIdx}/{steps.length}
            </span>
          </div>
        </header>

        <div className="space-y-3">
          {steps.map((s, idx) => {
            const run = runByIdx.get(idx);
            const isDone = idx < currentIdx;
            const isCurrent = idx === currentIdx && !isComplete;
            return (
              <div
                key={`${s.key}-${idx}`}
                className={cn(
                  "glass-panel rounded-2xl p-5 transition",
                  isCurrent && "ring-2 ring-accent/40 shadow-[var(--shadow-elevated)]",
                  !isDone && !isCurrent && "opacity-60",
                )}
              >
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 flex-shrink-0">
                    {isDone ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <Circle className={cn("h-5 w-5", isCurrent ? "text-accent" : "text-muted-foreground")} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                        Étape {idx + 1}
                      </span>
                      {s.type && (
                        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {s.type}
                        </span>
                      )}
                      {s.delay_days != null && (
                        <span className="text-[10.5px] text-muted-foreground">
                          ⏱ {s.delay_days} j
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1 text-[15px] font-semibold">{s.title}</h3>
                    {s.description && (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                        {s.description}
                      </p>
                    )}
                    {s.legal_refs && s.legal_refs.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {s.legal_refs.map((r, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-[11px] text-foreground/80"
                          >
                            <BookOpen className="h-3 w-3" />
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                    {run?.notes && (
                      <div className="mt-3 rounded-lg bg-secondary/40 p-2.5 text-[12px] text-foreground/80">
                        <span className="font-medium">Note : </span>
                        {run.notes}
                      </div>
                    )}

                    {isCurrent && (
                      <div className="mt-4 space-y-3 border-t border-border pt-4">
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Notes / commentaires (optionnel)…"
                          rows={2}
                          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-[13px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                        />
                        <button
                          type="button"
                          onClick={handleComplete}
                          disabled={advancing}
                          className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-4 text-[12.5px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
                        >
                          {advancing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Valider l'étape
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {isComplete && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center text-[13px] text-emerald-600">
            ✅ Procédure terminée le {new Date(inst.completed_at).toLocaleDateString("fr-FR")}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// Avoid unused warning for ExternalLink/Link in some bundlers
void ExternalLink;
void Link;
