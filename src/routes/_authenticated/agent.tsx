// Vue "assistant" — l'utilisateur ne voit JAMAIS la machine à états.
// Il pose sa question (ou joint un document), l'agent fait tout le reste :
//   • réfléchit  • pose des questions si besoin  • demande validation si sensible
//   • affiche la réponse sourcée + les documents prêts à télécharger / imprimer / envoyer
//
// Toute la terminologie technique (pending, running, waiting_info, ready, executed…)
// est cachée derrière des libellés naturels.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
import { runOcrDocument } from "@/server/ocr.functions";
import { getGeneratedDocument } from "@/server/generation.functions";
import { loadWorkflowInstanceState as getWorkflowInstance } from "@/server/workflow-runtime.functions";
import { WorkflowStatusBanner } from "@/components/agent/WorkflowStatusBanner";
import { WorkflowStepInline } from "@/components/agent/WorkflowStepInline";
import { supabase } from "@/integrations/supabase/client";
import DOMPurify from "dompurify";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Loader2,
  Send,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Download,
  Printer,
  Mail,
  FileText,
  Paperclip,
  Shield,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/agent")({
  component: AssistantPage,
});

type Run = {
  id: string;
  title: string | null;
  message: string;
  status: string;
  created_at: string;
  updated_at: string;
};

// Libellés "humains" — jamais de jargon technique côté UI.
function humanLabel(status: string): { label: string; tone: "work" | "ask" | "ok" | "err" } {
  switch (status) {
    case "pending":
    case "running":
      return { label: "L'agent travaille…", tone: "work" };
    case "waiting_info":
      return { label: "Quelques précisions nécessaires", tone: "ask" };
    case "waiting_validation":
      return { label: "Votre validation est demandée", tone: "ask" };
    case "ready":
      return { label: "Finalisation…", tone: "work" };
    case "executed":
      return { label: "Terminé", tone: "ok" };
    case "archived":
      return { label: "Archivé", tone: "ok" };
    case "failed":
      return { label: "Une erreur est survenue", tone: "err" };
    default:
      return { label: "En cours", tone: "work" };
  }
}

function AssistantPage() {
  const create = useServerFn(createAgentRun);
  const process = useServerFn(processAgentRun);
  const execute = useServerFn(executeAgentRun);
  const list = useServerFn(listMyRuns);
  const ocr = useServerFn(runOcrDocument);

  const [runs, setRuns] = useState<Run[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    try {
      const data = await list({ data: { scope: "mine", limit: 30 } });
      setRuns(data as unknown as Run[]);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refresh();
    let userId: string | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      userId = auth.user?.id ?? null;
      if (!userId) return;
      channel = supabase
        .channel(`agent_runs:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "agent_runs", filter: `user_id=eq.${userId}` },
          () => { void refresh(); },
        )
        .subscribe();
    })();
    // Fallback léger (15s) si Realtime indisponible
    const fallback = setInterval(refresh, 15000);
    return () => {
      clearInterval(fallback);
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  const uploadAttachments = async (): Promise<Array<{ analysis_id: string; filename: string }>> => {
    if (pendingFiles.length === 0) return [];
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) throw new Error("Session expirée");
    const out: Array<{ analysis_id: string; filename: string }> = [];
    for (const file of pendingFiles) {
      const path = `${userId}/agent/${Date.now()}-${file.name}`;
      const up = await supabase.storage.from("dossier-files").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (up.error) throw new Error(`Upload ${file.name} : ${up.error.message}`);
      const result = (await ocr({
        data: {
          storage_path: path,
          filename: file.name,
          file_type: file.type || "application/octet-stream",
        },
      })) as { id: string };
      out.push({ analysis_id: result.id, filename: file.name });
    }
    return out;
  };

  const handleSubmit = async () => {
    if (!message.trim() && pendingFiles.length === 0) return;
    setSubmitting(true);
    const text = message.trim() || `Analyse du document : ${pendingFiles.map((f) => f.name).join(", ")}`;
    setMessage("");
    const filesSnapshot = pendingFiles;
    setPendingFiles([]);
    try {
      let attachments: Array<{ analysis_id: string; filename: string }> = [];
      if (filesSnapshot.length > 0) {
        toast.info("Analyse de votre document…");
        attachments = await uploadAttachments();
      }
      const created = (await create({ data: { message: text, attachments } })) as { id: string };
      setActiveId(created.id);
      await refresh();
      try {
        const r1 = (await process({ data: { id: created.id } })) as { status: string };
        await refresh();
        if (r1.status === "ready") {
          await execute({ data: { id: created.id } });
          await refresh();
        }
      } catch (e) {
        console.error(e);
      }
    } catch (e) {
      toast.error((e as Error).message);
      setPendingFiles(filesSnapshot);
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) setPendingFiles((p) => [...p, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Votre assistant juridique</h1>
          <p className="text-sm text-muted-foreground">
            Posez votre question, joignez un document — je m'occupe du reste.
          </p>
        </div>
      </div>

      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <Textarea
            placeholder="Ex : Je veux licencier un salarié pour faute grave / Vérifier mon contrat fournisseur / Préparer une mise en demeure…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            disabled={submitting}
            className="resize-none border-0 focus-visible:ring-0 px-0 text-base"
          />
          {pendingFiles.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {pendingFiles.map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs"
                >
                  <FileText className="h-3 w-3" />
                  {f.name}
                  <button
                    type="button"
                    onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive ml-1"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.docx,.txt"
              className="hidden"
              onChange={onPickFiles}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
              disabled={submitting}
            >
              <Paperclip className="h-3.5 w-3.5" />
              Joindre un document
            </button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || (!message.trim() && pendingFiles.length === 0)}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Envoyer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Fil des échanges */}
      <div className="space-y-3">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Aucune demande pour l'instant. Commencez par décrire votre besoin ci-dessus.
          </p>
        ) : (
          runs.map((r) => (
            <RunCard
              key={r.id}
              summary={r}
              expanded={activeId === r.id}
              onToggle={() => setActiveId(activeId === r.id ? null : r.id)}
              onChanged={refresh}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carte d'une demande — affiche l'état naturellement et déroule le détail
// ---------------------------------------------------------------------------
function RunCard({
  summary,
  expanded,
  onToggle,
  onChanged,
}: {
  summary: Run;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const get = useServerFn(getAgentRun);
  const [run, setRun] = useState<Record<string, unknown> | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const load = async () => {
    try {
      const r = (await get({ data: { id: summary.id } })) as Record<string, unknown>;
      setRun(r);
    } catch (e) {
      console.error(e);
    }
  };

  // Realtime sur cette run + fallback polling léger tant qu'elle est en cours
  useEffect(() => {
    if (!expanded) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }
    void load();
    const inFlight = ["pending", "running", "ready"].includes(summary.status);
    const channel = supabase
      .channel(`agent_run:${summary.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "agent_runs", filter: `id=eq.${summary.id}` },
        () => { void load(); },
      )
      .subscribe();
    if (inFlight) {
      pollingRef.current = setInterval(load, 8000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, summary.status, summary.id]);

  const meta = humanLabel(summary.status);
  const dotColor =
    meta.tone === "work"
      ? "bg-blue-500 animate-pulse"
      : meta.tone === "ask"
        ? "bg-amber-500"
        : meta.tone === "err"
          ? "bg-destructive"
          : "bg-emerald-500";

  return (
    <Card className="border-border/60 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left hover:bg-accent/30 transition-colors"
      >
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dotColor}`} />
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate text-sm">
              {summary.title || summary.message.slice(0, 80)}
            </p>
            <p className="text-xs text-muted-foreground">
              {meta.label} · {new Date(summary.updated_at).toLocaleString("fr-FR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </p>
          </div>
        </CardContent>
      </button>

      {expanded && run ? <RunDetail run={run} onChanged={onChanged} reload={load} /> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Détail conversationnel — pas de jargon, actions naturelles
// ---------------------------------------------------------------------------
function RunDetail({
  run,
  onChanged,
  reload,
}: {
  run: Record<string, unknown>;
  onChanged: () => void;
  reload: () => Promise<void>;
}) {
  const answer = useServerFn(answerAgentRun);
  const validate = useServerFn(validateAgentRun);
  const archive = useServerFn(archiveAgentRun);
  const execute = useServerFn(executeAgentRun);
  const process = useServerFn(processAgentRun);

  const [busy, setBusy] = useState(false);
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({});

  const status = run.status as string;
  const draft = (run.draft as Record<string, unknown>) ?? {};
  const missing = ((run.missing_information as unknown[]) ?? []) as Array<
    string | { key?: string; label?: string; question?: string }
  >;
  const procedure =
    (draft.procedure as Array<{ step: number; title: string; description: string }>) ?? [];
  const sources =
    (run.sources as Array<{ title: string; reference?: string; url?: string }>) ?? [];
  const answerText = (run.answer as string) ?? "";
  const refused = run.refused as boolean | null;
  const refusalReason = run.refusal_reason as string | null;
  const confidence = (run as Record<string, unknown>).confidence as number | null | undefined;

  const submitAnswers = async () => {
    setBusy(true);
    try {
      await answer({ data: { id: run.id as string, answers: formAnswers } });
      const r1 = (await process({ data: { id: run.id as string } })) as { status: string };
      if (r1.status === "ready") await execute({ data: { id: run.id as string } });
      await reload();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decideValidation = async (approved: boolean) => {
    setBusy(true);
    try {
      await validate({ data: { id: run.id as string, approved } });
      if (approved) await execute({ data: { id: run.id as string } });
      toast.success(approved ? "C'est parti !" : "Demande annulée");
      await reload();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doArchive = async () => {
    setBusy(true);
    try {
      await archive({ data: { id: run.id as string } });
      toast.success("Classé");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => window.print();

  const dossierId = (run.dossier_id as string | null) ?? null;
  const workflowInstanceId = (run.workflow_instance_id as string | null) ?? null;

  return (
    <div className="border-t border-border/60 px-4 py-4 space-y-4 bg-muted/20">
      {/* Demande initiale rappelée discrètement */}
      <div className="text-xs text-muted-foreground italic">
        « {run.message as string} »
      </div>

      {/* Suivi dans un dossier */}
      {dossierId && (
        <Link
          to="/dossiers/$id"
          params={{ id: dossierId }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
        >
          📁 Suivi dans le dossier — ouvrir
        </Link>
      )}

      {/* Procédure pas-à-pas (si workflow lié) */}
      {workflowInstanceId ? (
        <WorkflowRuntimeBlock instanceId={workflowInstanceId} onAdvanced={reload} />
      ) : null}

      {/* L'agent travaille */}
      {(status === "pending" || status === "running" || status === "ready") && !answerText ? (
        <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>
            L'agent analyse votre demande et prépare une réponse sourcée…
          </span>
        </div>
      ) : null}

      {/* Questions naturelles */}
      {status === "waiting_info" && missing.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm font-medium">
              Pour vous donner la meilleure réponse, j'ai besoin de quelques précisions :
            </p>
          </div>
          <div className="space-y-3 pl-6">
            {missing.map((m, i) => {
              const key = typeof m === "string" ? m : m.key ?? `q_${i}`;
              const label = typeof m === "string" ? m : m.label ?? m.question ?? key;
              return (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={key} className="text-sm font-normal">
                    {label}
                  </Label>
                  <Input
                    id={key}
                    value={formAnswers[key] ?? ""}
                    onChange={(e) => setFormAnswers({ ...formAnswers, [key]: e.target.value })}
                    className="bg-background"
                  />
                </div>
              );
            })}
            <Button onClick={submitAnswers} disabled={busy} size="sm" className="mt-2">
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : null}
              Continuer
            </Button>
          </div>
        </div>
      ) : null}

      {/* Validation naturelle */}
      {status === "waiting_validation" ? (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm font-medium">
              Cette action est sensible — confirmez-vous le lancement ?
            </p>
          </div>
          <div className="flex gap-2 pl-6">
            <Button onClick={() => decideValidation(true)} disabled={busy} size="sm">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Confirmer et lancer
            </Button>
            <Button
              variant="ghost"
              onClick={() => decideValidation(false)}
              disabled={busy}
              size="sm"
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      {/* Refus motivé */}
      {refused && refusalReason ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium mb-1">Je préfère ne pas répondre :</p>
          <p className="text-muted-foreground">{refusalReason}</p>
        </div>
      ) : null}

      {/* Réponse */}
      {answerText ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-background border border-border/60 p-4">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Réponse
              </p>
              {confidence != null ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                    confidence >= 0.8
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                      : confidence >= 0.5
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                        : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
                  )}
                  title="Niveau de confiance estimé par l'agent"
                >
                  <Shield className="h-3 w-3" />
                  {confidence >= 0.8
                    ? "Fiabilité élevée"
                    : confidence >= 0.5
                      ? "Fiabilité moyenne"
                      : "Fiabilité faible — vérifiez les sources"}
                  <span className="opacity-60">({Math.round(confidence * 100)}%)</span>
                </span>
              ) : null}
            </div>
            <div className="prose prose-sm max-w-none dark:prose-invert text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{answerText}</ReactMarkdown>
            </div>
          </div>

          {procedure.length > 0 ? (
            <div className="rounded-lg bg-background border border-border/60 p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Procédure à suivre
              </p>
              <ol className="space-y-3">
                {procedure.map((p) => (
                  <li key={p.step} className="flex gap-3">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {p.step}
                    </span>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{p.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{p.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {Array.isArray(run.final_document_ids) && (run.final_document_ids as unknown[]).length > 0 ? (
            <div className="rounded-lg bg-background border border-border/60 p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Documents prêts
              </p>
              <div className="space-y-2">
                {(run.final_document_ids as string[]).map((docId) => (
                  <GeneratedDocRow key={docId} docId={docId} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Sources discrètes */}
          {sources.length > 0 ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Voir les sources juridiques ({sources.length})
              </summary>
              <ul className="mt-2 space-y-1 pl-4">
                {sources.map((s, i) => (
                  <li key={i} className="text-muted-foreground">
                    [{i + 1}]{" "}
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                    {s.reference ? ` — ${s.reference}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {status !== "archived" ? (
            <div className="flex justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={doArchive} disabled={busy}>
                Classer cette demande
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {status === "failed" && !refused ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {(run.error_message as string) ?? "Une erreur s'est produite. Réessayez plus tard."}
        </div>
      ) : null}
    </div>
  );
}

// Ligne d'un document généré : charge le titre/HTML et propose télécharger/imprimer.
function GeneratedDocRow({ docId }: { docId: string }) {
  const getDoc = useServerFn(getGeneratedDocument);
  const [doc, setDoc] = useState<{ title?: string; content_html?: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = (await getDoc({ data: { id: docId } })) as { title: string; content_html: string };
        setDoc(r);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [docId]);

  const download = () => {
    if (!doc?.content_html) return;
    const cleanHtml = DOMPurify.sanitize(doc.content_html);
    const safeTitle = (doc.title ?? "Document").replace(/[<>&"']/g, "");
    const blob = new Blob(
      [`<!doctype html><meta charset="utf-8"><title>${safeTitle}</title>${cleanHtml}`],
      { type: "text/html;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(doc.title ?? "document").replace(/[^\w.-]+/g, "_")}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const print = () => {
    if (!doc?.content_html) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const cleanHtml = DOMPurify.sanitize(doc.content_html);
    const safeTitle = (doc.title ?? "").replace(/[<>&"']/g, "");
    w.document.write(`<!doctype html><title>${safeTitle}</title>${cleanHtml}`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="flex items-center gap-3 rounded-md border border-border/40 px-3 py-2">
      <FileText className="h-4 w-4 text-primary flex-shrink-0" />
      <span className="text-sm flex-1 truncate">{doc?.title ?? `Document #${docId.slice(0, 8)}`}</span>
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={download} disabled={!doc}>
        <Download className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={print} disabled={!doc}>
        <Printer className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2" disabled>
        <Mail className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloc runtime workflow — affiche le banner de fiabilité + l'étape courante
// quand l'agent a démarré une procédure pas-à-pas.
// ---------------------------------------------------------------------------
function WorkflowRuntimeBlock({
  instanceId,
  onAdvanced,
}: {
  instanceId: string;
  onAdvanced: () => Promise<void> | void;
}) {
  const getInstance = useServerFn(getWorkflowInstance);
  const [instance, setInstance] = useState<Record<string, unknown> | null>(null);

  const load = async () => {
    try {
      const r = (await getInstance({ data: { instance_id: instanceId } })) as Record<
        string,
        unknown
      >;
      setInstance(r);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  if (!instance) return null;

  const status = instance.status as string;
  const currentStep = instance.current_step as
    | { title?: string; description?: string; legal_refs?: unknown[]; requires_human_review?: boolean }
    | null;
  const stepIndex = (instance.current_step_index as number) ?? 0;
  const totalSteps = (instance.total_steps as number) ?? 0;
  const stepRuns = (instance.step_runs as Array<{ requires_validation: boolean; status: string }>) ?? [];
  const blocked = stepRuns.some(
    (r) => r.requires_validation && r.status === "pending",
  );
  const sensitive = currentStep?.requires_human_review === true;

  const bannerStatus =
    status === "completed"
      ? "human_validated"
      : blocked
        ? "pending_human_review"
        : sensitive
          ? "draft_ai"
          : "ai_validated_auto";

  return (
    <div className="space-y-3">
      <WorkflowStatusBanner
        status={bannerStatus}
        validationRequired={blocked || sensitive}
        executionBlocked={blocked}
      />
      <div className="text-xs text-muted-foreground">
        Procédure : <span className="font-medium text-foreground">{instance.definition_title as string}</span>
        {" · "}
        Étape {Math.min(stepIndex + 1, totalSteps)} / {totalSteps}
      </div>
      {status !== "completed" && currentStep ? (
        <WorkflowStepInline
          instanceId={instanceId}
          stepIndex={stepIndex}
          title={currentStep.title ?? `Étape ${stepIndex + 1}`}
          description={currentStep.description ?? null}
          legalRefs={
            (currentStep.legal_refs as Array<{ code?: string; article?: string; label?: string }>) ?? []
          }
          onAdvanced={async () => {
            await load();
            await onAdvanced();
          }}
        />
      ) : null}
    </div>
  );
}
