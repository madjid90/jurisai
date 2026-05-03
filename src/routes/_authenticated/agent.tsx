// Boîte aux lettres de l'agent JurisAI.
// Vue unique listant toutes les demandes de l'utilisateur, avec leur état
// dans le cycle de vie : pending → running → waiting_info / waiting_validation
// → ready → executed → archived (ou failed).

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  createAgentRun,
  processAgentRun,
  executeAgentRun,
  answerAgentRun,
  validateAgentRun,
  archiveAgentRun,
  listMyRuns,
  getAgentRun,
} from "@/server/agent-runs.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Send, Inbox, CheckCircle2, AlertCircle, Clock, Archive } from "lucide-react";

export const Route = createFileRoute("/_authenticated/agent")({
  component: AgentInboxPage,
});

type Run = {
  id: string;
  title: string | null;
  message: string;
  status: string;
  intent: string | null;
  domain: string | null;
  dossier_id: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_META: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: "En attente", color: "bg-muted text-muted-foreground", icon: Clock },
  running: { label: "En cours", color: "bg-blue-500/10 text-blue-700", icon: Loader2 },
  waiting_info: { label: "Infos requises", color: "bg-amber-500/10 text-amber-700", icon: AlertCircle },
  waiting_validation: { label: "Validation requise", color: "bg-orange-500/10 text-orange-700", icon: AlertCircle },
  ready: { label: "Prêt à exécuter", color: "bg-emerald-500/10 text-emerald-700", icon: CheckCircle2 },
  executed: { label: "Terminé", color: "bg-green-500/10 text-green-700", icon: CheckCircle2 },
  archived: { label: "Archivé", color: "bg-muted text-muted-foreground", icon: Archive },
  failed: { label: "Échec", color: "bg-destructive/10 text-destructive", icon: AlertCircle },
};

function AgentInboxPage() {
  const create = useServerFn(createAgentRun);
  const process = useServerFn(processAgentRun);
  const execute = useServerFn(executeAgentRun);
  const list = useServerFn(listMyRuns);

  const [runs, setRuns] = useState<Run[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const data = await list({ data: { scope: "mine", limit: 50 } });
      setRuns(data as unknown as Run[]);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000); // polling léger
    return () => clearInterval(t);
  }, []);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      const created = (await create({ data: { message: message.trim() } })) as { id: string };
      setMessage("");
      toast.success("Demande créée — l'agent analyse…");
      await refresh();

      // Auto-pipeline : process puis execute si pas d'attente humaine
      try {
        const r1 = (await process({ data: { id: created.id } })) as { status: string };
        await refresh();
        if (r1.status === "ready") {
          await execute({ data: { id: created.id } });
          toast.success("Réponse prête !");
          await refresh();
        } else if (r1.status === "waiting_info") {
          toast.info("L'agent a besoin d'informations complémentaires");
          setOpenId(created.id);
        } else if (r1.status === "waiting_validation") {
          toast.info("Validation requise");
          setOpenId(created.id);
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Inbox className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Boîte de l'agent</h1>
          <p className="text-sm text-muted-foreground">
            Posez votre demande — l'agent travaille en arrière-plan, rien ne se perd.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nouvelle demande</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Ex : Je veux licencier un salarié en CDI pour faute grave, par où commencer ?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            disabled={submitting}
          />
          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={submitting || !message.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Envoyer
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Mes demandes
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Aucune demande pour l'instant.</p>
        ) : (
          runs.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.pending;
            const Icon = meta.icon;
            return (
              <Card
                key={r.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => setOpenId(r.id)}
              >
                <CardContent className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{r.title || r.message.slice(0, 80)}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.updated_at).toLocaleString("fr-FR")}
                      {r.intent ? ` • ${r.intent}` : ""}
                      {r.domain ? ` • ${r.domain}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className={meta.color}>
                    <Icon className={`h-3 w-3 mr-1 ${r.status === "running" ? "animate-spin" : ""}`} />
                    {meta.label}
                  </Badge>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {openId ? <RunDetailDialog runId={openId} onClose={() => { setOpenId(null); refresh(); }} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Détail d'une run + actions contextuelles (répondre, valider, archiver)
// ---------------------------------------------------------------------------
function RunDetailDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const get = useServerFn(getAgentRun);
  const answer = useServerFn(answerAgentRun);
  const validate = useServerFn(validateAgentRun);
  const archive = useServerFn(archiveAgentRun);
  const execute = useServerFn(executeAgentRun);
  const process = useServerFn(processAgentRun);

  const [run, setRun] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      const r = (await get({ data: { id: runId } })) as Record<string, unknown>;
      setRun(r);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, [runId]);

  if (!run) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const status = run.status as string;
  const draft = (run.draft as Record<string, unknown>) ?? {};
  const missing = ((run.missing_information as unknown[]) ?? []) as Array<
    string | { key?: string; label?: string; question?: string }
  >;
  const procedure = (draft.procedure as Array<{ step: number; title: string; description: string }>) ?? [];
  const sources = (run.sources as Array<{ title: string; reference?: string; url?: string }>) ?? [];
  const answerText = (run.answer as string) ?? "";

  const submitAnswers = async () => {
    setBusy(true);
    try {
      await answer({ data: { id: runId, answers: formAnswers } });
      toast.success("Infos transmises — l'agent reprend");
      // Relance auto
      const r1 = (await process({ data: { id: runId } })) as { status: string };
      if (r1.status === "ready") await execute({ data: { id: runId } });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decideValidation = async (approved: boolean) => {
    setBusy(true);
    try {
      await validate({ data: { id: runId, approved } });
      if (approved) await execute({ data: { id: runId } });
      toast.success(approved ? "Validé et exécuté" : "Rejeté et archivé");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doArchive = async () => {
    setBusy(true);
    try {
      await archive({ data: { id: runId } });
      toast.success("Archivé");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{(run.title as string) || "Demande"}</DialogTitle>
          <DialogDescription className="text-sm">
            <Badge variant="outline" className={STATUS_META[status]?.color}>
              {STATUS_META[status]?.label ?? status}
            </Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div>
            <Label className="text-muted-foreground">Demande initiale</Label>
            <p className="mt-1">{run.message as string}</p>
          </div>

          {/* État : waiting_info → formulaire dynamique */}
          {status === "waiting_info" && missing.length > 0 ? (
            <div className="space-y-3 border-l-2 border-amber-500 pl-4">
              <p className="font-medium">L'agent a besoin de précisions :</p>
              {missing.map((m, i) => {
                const key = typeof m === "string" ? m : m.key ?? `q_${i}`;
                const label = typeof m === "string" ? m : m.label ?? m.question ?? key;
                return (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={key}>{label}</Label>
                    <Input
                      id={key}
                      value={formAnswers[key] ?? ""}
                      onChange={(e) => setFormAnswers({ ...formAnswers, [key]: e.target.value })}
                    />
                  </div>
                );
              })}
              <Button onClick={submitAnswers} disabled={busy} className="w-full">
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Transmettre à l'agent
              </Button>
            </div>
          ) : null}

          {/* État : waiting_validation */}
          {status === "waiting_validation" ? (
            <div className="space-y-3 border-l-2 border-orange-500 pl-4">
              <p className="font-medium">Action sensible — votre validation est requise.</p>
              <div className="flex gap-2">
                <Button variant="default" onClick={() => decideValidation(true)} disabled={busy}>
                  Approuver et exécuter
                </Button>
                <Button variant="outline" onClick={() => decideValidation(false)} disabled={busy}>
                  Rejeter
                </Button>
              </div>
            </div>
          ) : null}

          {/* Réponse finale */}
          {answerText ? (
            <div>
              <Label className="text-muted-foreground">Réponse</Label>
              <div className="mt-1 whitespace-pre-wrap rounded border bg-muted/30 p-3">{answerText}</div>
            </div>
          ) : null}

          {/* Procédure */}
          {procedure.length > 0 ? (
            <div>
              <Label className="text-muted-foreground">Procédure</Label>
              <ol className="mt-2 space-y-2">
                {procedure.map((p) => (
                  <li key={p.step} className="rounded border p-3">
                    <p className="font-medium">
                      {p.step}. {p.title}
                    </p>
                    <p className="text-muted-foreground mt-1">{p.description}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {/* Sources */}
          {sources.length > 0 ? (
            <div>
              <Label className="text-muted-foreground">Sources juridiques</Label>
              <ul className="mt-1 space-y-1 text-xs">
                {sources.map((s, i) => (
                  <li key={i}>
                    [source:{i + 1}]{" "}
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                    {s.reference ? ` — ${s.reference}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(run.error_message as string) ? (
            <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-destructive">
              {run.error_message as string}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {status !== "archived" ? (
            <Button variant="ghost" onClick={doArchive} disabled={busy}>
              <Archive className="h-4 w-4 mr-2" />
              Archiver
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
