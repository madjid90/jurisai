// Composant inline pour afficher l'étape courante d'un workflow dans le chat agent.
// Affiche : titre/description étape, échéance calculée, refs légales, boutons Exécuter/Passer.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { runWorkflowStep, skipWorkflowStep } from "@/lib/server-fns/workflow-runtime.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Clock, AlertTriangle, SkipForward, Loader2 } from "lucide-react";
import { toast } from "sonner";

export type WorkflowStepInlineProps = {
  instanceId: string;
  stepIndex: number;
  title: string;
  description?: string | null;
  legalRefs?: Array<{ code?: string; article?: string; label?: string }>;
  onAdvanced?: () => void;
};

export function WorkflowStepInline({
  instanceId,
  stepIndex,
  title,
  description,
  legalRefs = [],
  onAdvanced,
}: WorkflowStepInlineProps) {
  const runFn = useServerFn(runWorkflowStep);
  const skipFn = useServerFn(skipWorkflowStep);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [showSkip, setShowSkip] = useState(false);

  async function handleExecute() {
    setBusy(true);
    try {
      const res = await runFn({
        data: { instance_id: instanceId, step_index: stepIndex, notes: notes || undefined },
      });
      if (res.blocked_for_validation) {
        toast.warning("Étape sensible : validation requise avant exécution.");
      } else if (res.workflow_completed) {
        toast.success("Procédure terminée.");
      } else {
        toast.success(
          res.delay
            ? `Étape franchie. Échéance : ${res.delay.dueDate} (${res.delay.rule}).`
            : "Étape franchie.",
        );
      }
      onAdvanced?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip() {
    if (reason.trim().length < 3) {
      toast.error("Motif requis pour passer une étape.");
      return;
    }
    setBusy(true);
    try {
      await skipFn({ data: { instance_id: instanceId, step_index: stepIndex, reason } });
      toast.success("Étape ignorée.");
      onAdvanced?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Clock className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold">
            Étape {stepIndex + 1} — {title}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{description}</p>
          )}
        </div>
      </div>

      {legalRefs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {legalRefs.map((r, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {r.label ?? `${r.code ?? ""} ${r.article ?? ""}`.trim()}
            </span>
          ))}
        </div>
      )}

      {!showSkip ? (
        <>
          <Textarea
            placeholder="Notes d'exécution (optionnel)…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleExecute} disabled={busy} size="sm">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Exécuter l'étape
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowSkip(true)} disabled={busy}>
              <SkipForward className="h-3.5 w-3.5" />
              Passer
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Si l'étape contient une action sensible (licenciement, mise en demeure…), une validation humaine sera demandée automatiquement.
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <Textarea
            placeholder="Motif (obligatoire)…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={handleSkip} disabled={busy} size="sm" variant="destructive">
              Confirmer
            </Button>
            <Button onClick={() => setShowSkip(false)} disabled={busy} size="sm" variant="ghost">
              Annuler
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
