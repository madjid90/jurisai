// Vue "assistant" — l'utilisateur ne voit JAMAIS la machine à états.
// Il pose sa question (ou joint un document), l'agent fait tout le reste :
//   • réfléchit  • pose des questions si besoin  • demande validation si sensible
//   • affiche la réponse sourcée + les documents prêts à télécharger / imprimer / envoyer
//
// Toute la terminologie technique (pending, running, waiting_info, ready, executed…)
// est cachée derrière des libellés naturels.

import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
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
  listChildRuns,
  attachRunToDossier,
} from "@/lib/agent/agent-runs.functions";
import { runOcrDocument } from "@/lib/server-fns/ocr.functions";
import { getGeneratedDocument } from "@/lib/server-fns/generation.functions";
import { WorkflowRuntimeBlock } from "@/components/agent/WorkflowRuntimeBlock";
import { supabase } from "@/integrations/supabase/client";
import DOMPurify from "dompurify";
import { marked } from "marked";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app/AppShell";
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
  // Mail,
  FileText,
  Paperclip,
  Shield,
  RotateCcw,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/agent")({
  validateSearch: z.object({
    run: z.string().uuid().optional(),
    mode: z.enum(["chat", "document", "procedure", "dossier_selection"]).optional(),
  }),
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
  const search = useSearch({ from: "/_authenticated/agent" });
  const navigate = useNavigate({ from: "/_authenticated/agent" });
  const focusRunId = search.run ?? null;

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
      // Bascule en mode focus : la conversation prend toute la page
      void navigate({ search: { run: created.id }, replace: false });
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

  // Mode focus : une question = une page dédiée, sans le composer ni la liste
  if (focusRunId) {
    const focusSummary = runs.find((r) => r.id === focusRunId) ?? {
      id: focusRunId,
      title: null,
      message: "",
      status: submitting ? "running" : "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 sm:py-10 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void navigate({ search: { run: undefined } })}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
            >
              ← Retour à l'assistant
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigate({ search: { run: undefined } })}
              className="gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Nouvelle question
            </Button>
          </div>
          <ModeBanner mode={search.mode} />
          {search.mode === "dossier_selection" ? (
            <DossierSelectionPanel runId={focusRunId} onAttached={() => void refresh()} />
          ) : null}
          <RunCard
            key={focusRunId}
            summary={focusSummary as Run}
            expanded
            onToggle={() => {}}
            onChanged={refresh}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        {/* En-tête */}
        <header className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-primary to-accent text-primary-foreground shadow-lg shadow-primary/20">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Votre assistant juridique
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Posez votre question, joignez un document — je m'occupe du reste.
            </p>
          </div>
        </header>

        {/* Composer */}
        <Card className="border-border/60 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <Textarea
              placeholder="Ex : Je veux licencier un salarié pour faute grave / Vérifier mon contrat fournisseur / Préparer une mise en demeure…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              disabled={submitting}
              className="resize-none border-0 focus-visible:ring-0 px-4 pt-4 pb-2 text-base bg-transparent shadow-none"
            />
            {pendingFiles.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-4 pb-2">
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
            <div className="flex items-center justify-between gap-3 border-t border-border/50 bg-muted/30 px-3 py-2">
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
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-background transition"
                disabled={submitting}
              >
                <Paperclip className="h-3.5 w-3.5" />
                Joindre un document
              </button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || (!message.trim() && pendingFiles.length === 0)}
                size="sm"
                className="gap-1.5"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Envoyer
                <kbd className="hidden sm:inline ml-1 text-[10px] opacity-60">⌘↵</kbd>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Fil des échanges */}
        <div className="space-y-2">
          {runs.length === 0 ? (
            <EmptyState onPick={(prompt) => setMessage(prompt)} />
          ) : (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                Vos demandes récentes
              </p>
              {runs.map((r) => (
                <RunCard
                  key={r.id}
                  summary={r}
                  expanded={false}
                  onToggle={() => void navigate({ search: { run: r.id } })}
                  onChanged={refresh}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Empty state — accueil engageant avec exemples couvrant les domaines clés
// (RH, commercial, sociétés, RGPD, fiscalité, contentieux). Pas de jargon.
// ---------------------------------------------------------------------------
function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  const examples: Array<{ domain: string; prompt: string; emoji: string }> = [
    {
      domain: "Ressources humaines",
      emoji: "👥",
      prompt: "Je veux licencier un salarié pour faute grave — quelle procédure suivre ?",
    },
    {
      domain: "Commercial",
      emoji: "🤝",
      prompt: "Vérifier mon contrat fournisseur et identifier les clauses à risque.",
    },
    {
      domain: "Sociétés",
      emoji: "🏢",
      prompt: "Préparer une AGE pour modifier l'objet social de ma SAS.",
    },
    {
      domain: "RGPD",
      emoji: "🔒",
      prompt: "Rédiger une politique de confidentialité conforme RGPD pour mon site.",
    },
    {
      domain: "Contentieux",
      emoji: "⚖️",
      prompt: "Préparer une mise en demeure pour facture impayée depuis 60 jours.",
    },
    {
      domain: "Fiscalité",
      emoji: "📊",
      prompt: "Quelles obligations fiscales pour une auto-entreprise dépassant 35 000 € ?",
    },
  ];

  return (
    <div className="py-8 space-y-6">
      <div className="text-center space-y-1.5">
        <p className="text-sm font-medium">Par où commencer ?</p>
        <p className="text-xs text-muted-foreground">
          Choisissez un exemple ou décrivez votre situation dans vos propres mots.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-2.5">
        {examples.map((ex, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(ex.prompt)}
            className="group text-left rounded-lg border border-border/60 bg-background hover:border-primary/40 hover:bg-accent/30 transition p-3 space-y-1"
          >
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">{ex.emoji}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground group-hover:text-primary transition">
                {ex.domain}
              </span>
            </div>
            <p className="text-sm text-foreground/90 leading-snug">{ex.prompt}</p>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground text-center">
        Toutes les réponses sont sourcées sur la base juridique officielle. L'agent vous
        demande des précisions si besoin et votre validation pour les actions sensibles.
      </p>
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
  const processFn = useServerFn(processAgentRun);
  const executeFn = useServerFn(executeAgentRun);
  const [run, setRun] = useState<Record<string, unknown> | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const kickedRef = useRef(false);

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
    // Auto-kick : si la run est restée en pending sans intent (créée depuis le
    // dashboard sans que process() ait été appelé), on lance la classification.
    if (summary.status === "pending" && !kickedRef.current) {
      kickedRef.current = true;
      void (async () => {
        try {
          const r1 = (await processFn({ data: { id: summary.id } })) as { status: string };
          if (r1.status === "ready") await executeFn({ data: { id: summary.id } });
          await load();
        } catch (e) {
          console.error("[agent] auto-kick process failed:", e);
        }
      })();
    }
    const channel = supabase
      .channel(`agent_run:${summary.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "agent_runs", filter: `id=eq.${summary.id}` },
        () => { void load(); },
      )
      .subscribe();
    if (inFlight) {
      // Polling allégé : 20s (Realtime gère les mises à jour rapides)
      pollingRef.current = setInterval(load, 20000);
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

  const toneBadge =
    meta.tone === "work"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
      : meta.tone === "ask"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        : meta.tone === "err"
          ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";

  return (
    <Card
      className={cn(
        "border-border/60 overflow-hidden transition-shadow",
        expanded ? "shadow-md ring-1 ring-primary/10" : "hover:shadow-sm",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left hover:bg-accent/30 transition-colors"
      >
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <span className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", dotColor)} />
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate text-sm">
              {summary.title || summary.message.slice(0, 80)}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium", toneBadge)}>
                {meta.label}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {new Date(summary.updated_at).toLocaleString("fr-FR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </div>
          </div>
          <span className="text-muted-foreground/60 text-xs flex-shrink-0">
            {expanded ? "−" : "+"}
          </span>
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
  const create = useServerFn(createAgentRun);

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
    <div className="border-t border-border/60 px-4 py-5 space-y-5 bg-muted/20">
      {/* Rappel de la demande — proéminent pour garder le focus */}
      <div className="rounded-xl border border-primary/15 bg-primary/[0.04] p-4">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
            Votre demande
          </p>
          {dossierId ? (
            <Link
              to="/dossiers/$id"
              params={{ id: dossierId }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition"
            >
              📁 Voir le dossier lié
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed">
          {run.message as string}
        </p>
      </div>

      {/* Procédure pas-à-pas (si workflow lié) */}
      {workflowInstanceId ? (
        <WorkflowRuntimeBlock instanceId={workflowInstanceId} onAdvanced={reload} />
      ) : null}

      {/* L'agent travaille — stepper visuel + tool calls live */}
      {(status === "pending" || status === "running" || status === "ready") && !answerText ? (
        <>
          <AgentProgressStepper status={status} />
          <ToolCallsLive runId={run.id as string} />
        </>
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
          <ActionsRecap runId={run.id as string} />
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

          {/* Sources visibles par défaut — preuve de fiabilité */}
          {sources.length > 0 ? (
            <div className="rounded-lg bg-background border border-border/60 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Sources juridiques
                </p>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                  <Shield className="h-2.5 w-2.5" />
                  {sources.length} source{sources.length > 1 ? "s" : ""} vérifiée{sources.length > 1 ? "s" : ""}
                </span>
              </div>
              <SourcesList sources={sources} />
            </div>
          ) : null}

          {/* Panneau Actions — proéminent et groupé */}
          {status !== "archived" ? (
            <div className="rounded-lg border border-primary/20 bg-gradient-to-br from-primary/[0.03] to-accent/[0.03] p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Que voulez-vous faire ?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() =>
                    exportAnswerToPdf({
                      title: (run.title as string) || (run.message as string).slice(0, 80),
                      question: run.message as string,
                      answer: answerText,
                      procedure,
                      sources,
                      confidence: confidence ?? null,
                      createdAt: run.created_at as string | undefined,
                    })
                  }
                  className="justify-start gap-2 h-auto py-2.5"
                >
                  <Download className="h-4 w-4 flex-shrink-0" />
                  <div className="text-left">
                    <div className="text-xs font-semibold">Télécharger en PDF</div>
                    <div className="text-[10px] opacity-80 font-normal">Réponse + procédure + sources</div>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrint}
                  className="justify-start gap-2 h-auto py-2.5"
                >
                  <Printer className="h-4 w-4 flex-shrink-0" />
                  <div className="text-left">
                    <div className="text-xs font-semibold">Imprimer</div>
                    <div className="text-[10px] opacity-70 font-normal">Version papier</div>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={doArchive}
                  disabled={busy}
                  className="justify-start gap-2 h-auto py-2.5"
                >
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <div className="text-left">
                    <div className="text-xs font-semibold">Classer cette demande</div>
                    <div className="text-[10px] opacity-70 font-normal">
                      {dossierId ? "Dans le dossier lié" : "Marquer comme traitée"}
                    </div>
                  </div>
                </Button>
                <a
                  href="#follow-up-thread"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(`follow-up-${run.id as string}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                    document.getElementById(`follow-up-input-${run.id as string}`)?.focus();
                  }}
                  className="inline-flex items-center justify-start gap-2 h-auto py-2.5 px-3 rounded-md border border-border bg-background hover:bg-accent transition text-sm"
                >
                  <Send className="h-4 w-4 flex-shrink-0" />
                  <div className="text-left">
                    <div className="text-xs font-semibold">Préciser ou compléter</div>
                    <div className="text-[10px] opacity-70 font-normal">Poser une question de suivi</div>
                  </div>
                </a>
              </div>
            </div>
          ) : null}

          {/* Fil conversationnel : suivis et nouvelle question */}
          <FollowUpThread
            parentId={run.id as string}
            dossierId={dossierId}
            onChanged={() => {
              void reload();
              onChanged();
            }}
          />
        </div>
      ) : null}

      {status === "failed" && !refused ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="flex-1">
              {(run.error_message as string) ?? "Une erreur s'est produite. Réessayez plus tard."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await create({
                  data: {
                    message: run.message as string,
                    dossier_id: (run.dossier_id as string | null) ?? undefined,
                  },
                });
                onChanged();
                toast.success("Nouvelle demande créée");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="gap-2"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réessayer
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export PDF — génère un PDF propre (réponse + procédure + sources) via une
// fenêtre d'impression dédiée. Le navigateur permet "Enregistrer en PDF".
// Approche choisie pour préserver typographie, pagination et liens cliquables.
// ---------------------------------------------------------------------------
function exportAnswerToPdf({
  title,
  question,
  answer,
  procedure,
  sources,
  confidence,
  createdAt,
}: {
  title: string;
  question: string;
  answer: string;
  procedure: Array<{ step: number; title: string; description: string }>;
  sources: Array<{ title: string; reference?: string; url?: string }>;
  confidence: number | null;
  createdAt?: string;
}) {
  // Conversion markdown → HTML (sync via marked.parse)
  const answerHtml = DOMPurify.sanitize(marked.parse(answer ?? "", { async: false }) as string);
  const safeTitle = (title || "Réponse JurisAI").replace(/[<>&"']/g, "");
  const safeQuestion = DOMPurify.sanitize(question ?? "");
  const dateStr = createdAt
    ? new Date(createdAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });

  const confidenceBlock =
    confidence != null
      ? `<span class="badge badge-${confidence >= 0.8 ? "ok" : confidence >= 0.5 ? "mid" : "low"}">
          Fiabilité ${Math.round(confidence * 100)}%
        </span>`
      : "";

  const procedureBlock =
    procedure.length > 0
      ? `<section>
          <h2>Procédure à suivre</h2>
          <ol class="procedure">
            ${procedure
              .map(
                (p) => `
              <li>
                <p class="step-title">${DOMPurify.sanitize(p.title)}</p>
                <p class="step-desc">${DOMPurify.sanitize(p.description)}</p>
              </li>`,
              )
              .join("")}
          </ol>
        </section>`
      : "";

  const sourcesBlock =
    sources.length > 0
      ? `<section>
          <h2>Sources juridiques</h2>
          <ol class="sources">
            ${sources
              .map((s) => {
                const t = DOMPurify.sanitize(s.title ?? "");
                const ref = s.reference ? ` — ${DOMPurify.sanitize(s.reference)}` : "";
                if (s.url) {
                  const safeUrl = /^https?:\/\//i.test(s.url) ? s.url : "";
                  return safeUrl
                    ? `<li><a href="${safeUrl}">${t}</a>${ref}</li>`
                    : `<li>${t}${ref}</li>`;
                }
                return `<li>${t}${ref}</li>`;
              })
              .join("")}
          </ol>
        </section>`
      : "";

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    line-height: 1.55;
    font-size: 11pt;
    margin: 0;
  }
  header { border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { font-size: 10pt; color: #2563eb; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
  h1 { font-size: 17pt; margin: 6px 0 4px; color: #0f172a; }
  .meta { font-size: 9pt; color: #64748b; }
  .question {
    background: #f1f5f9; border-left: 3px solid #2563eb;
    padding: 10px 14px; margin: 14px 0 18px; font-style: italic; color: #334155; font-size: 10.5pt;
  }
  h2 {
    font-size: 12pt; color: #0f172a; margin: 22px 0 10px;
    border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;
  }
  .answer { font-size: 11pt; }
  .answer h1, .answer h2, .answer h3 { color: #0f172a; }
  .answer h1 { font-size: 14pt; } .answer h2 { font-size: 12.5pt; border: 0; padding: 0; }
  .answer h3 { font-size: 11.5pt; }
  .answer p { margin: 8px 0; }
  .answer ul, .answer ol { padding-left: 22px; }
  .answer li { margin: 4px 0; }
  .answer table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10pt; }
  .answer th, .answer td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  .answer th { background: #f1f5f9; }
  .answer code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 10pt; }
  .answer blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding-left: 12px; color: #475569; }
  .procedure { padding-left: 22px; }
  .procedure li { margin-bottom: 10px; page-break-inside: avoid; }
  .step-title { font-weight: 600; color: #0f172a; margin: 0 0 2px; }
  .step-desc { color: #475569; margin: 0; font-size: 10.5pt; }
  .sources { padding-left: 22px; font-size: 10pt; color: #475569; }
  .sources li { margin: 3px 0; page-break-inside: avoid; }
  .sources a { color: #2563eb; text-decoration: none; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 8.5pt; font-weight: 600; margin-left: 8px; vertical-align: middle;
  }
  .badge-ok { background: #d1fae5; color: #065f46; }
  .badge-mid { background: #fef3c7; color: #92400e; }
  .badge-low { background: #fee2e2; color: #991b1b; }
  footer {
    margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e8f0;
    font-size: 8.5pt; color: #94a3b8; text-align: center;
  }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <header>
    <div class="brand">JurisAI · Assistant juridique</div>
    <h1>${safeTitle}${confidenceBlock}</h1>
    <div class="meta">Généré le ${dateStr}</div>
  </header>

  <div class="question">« ${safeQuestion} »</div>

  <section>
    <h2>Réponse</h2>
    <div class="answer">${answerHtml}</div>
  </section>

  ${procedureBlock}
  ${sourcesBlock}

  <footer>
    Document généré par JurisAI à titre informatif. Les réponses sont sourcées sur la base juridique officielle
    mais ne se substituent pas à un conseil personnalisé d'un professionnel du droit.
  </footer>

  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 250);
    };
  </script>
</body>
</html>`;

  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1100");
  if (!w) {
    toast.error("Veuillez autoriser les pop-ups pour exporter en PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
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
      {/* Bouton Mail masqué tant que l'envoi par email n'est pas implémenté. */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stepper de progression — montre les 4 phases de réflexion de l'agent
// (Comprendre → Sourcer → Rédiger → Finaliser) sans jargon technique.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Tool calls live — affiche en temps réel les outils que l'agent appelle
// (recherche juridique, OCR, génération doc…) traduits en libellés humains.
// ---------------------------------------------------------------------------
const TOOL_LABELS: Record<string, { label: string; emoji: string }> = {
  search_legal_database: { label: "Consultation de la base juridique", emoji: "📚" },
  search_legal: { label: "Consultation de la base juridique", emoji: "📚" },
  rag_search: { label: "Recherche dans les sources", emoji: "🔎" },
  multi_query_rag: { label: "Recherche multi-angles", emoji: "🔎" },
  identify_risk: { label: "Identification des risques", emoji: "⚠️" },
  classify_intent: { label: "Compréhension de la demande", emoji: "🧭" },
  generate_document: { label: "Rédaction du document", emoji: "📝" },
  generate_doc: { label: "Rédaction du document", emoji: "📝" },
  ocr_document: { label: "Lecture du document joint", emoji: "👁️" },
  ocr: { label: "Lecture du document joint", emoji: "👁️" },
  read_dossier: { label: "Lecture du dossier", emoji: "📁" },
  list_workflows: { label: "Recherche d'une procédure", emoji: "🗂️" },
  start_workflow: { label: "Démarrage de la procédure", emoji: "▶️" },
  send_notification: { label: "Préparation d'une notification", emoji: "🔔" },
  request_validation: { label: "Demande de validation", emoji: "✋" },
};

function humanizeTool(name: string): { label: string; emoji: string } {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  // Fallback : prettify snake_case
  const pretty = name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { label: pretty, emoji: "🔧" };
}

type ToolRunRow = {
  id: string;
  tool_name: string;
  succeeded: boolean | null;
  duration_ms: number | null;
  created_at: string;
};

function ToolCallsLive({ runId }: { runId: string }) {
  const [rows, setRows] = useState<ToolRunRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fetchRows = async () => {
      const { data } = await supabase
        .from("agent_tool_runs")
        .select("id, tool_name, succeeded, duration_ms, created_at")
        .eq("agent_run_id", runId)
        .order("created_at", { ascending: true })
        .limit(50);
      if (!cancelled && data) setRows(data as ToolRunRow[]);
    };
    void fetchRows();
    const channel = supabase
      .channel(`agent_tool_runs:${runId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_tool_runs", filter: `agent_run_id=eq.${runId}` },
        () => { void fetchRows(); },
      )
      .subscribe();
    // Polling allégé : 15s (Realtime gère les mises à jour rapides)
    const interval = setInterval(fetchRows, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [runId]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        En coulisses
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const { label, emoji } = humanizeTool(r.tool_name);
          const inProgress = r.succeeded === null;
          return (
            <li key={r.id} className="flex items-center gap-2 text-xs">
              <span className="text-sm leading-none">{emoji}</span>
              <span
                className={cn(
                  "flex-1 truncate",
                  inProgress ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              {inProgress ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : r.succeeded ? (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  {r.duration_ms != null ? (
                    <span className="text-[10px] opacity-70">
                      {r.duration_ms < 1000 ? `${r.duration_ms}ms` : `${(r.duration_ms / 1000).toFixed(1)}s`}
                    </span>
                  ) : null}
                </span>
              ) : (
                <AlertCircle className="h-3 w-3 text-destructive" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Récap des actions effectuées — agrégation des agent_tool_runs réussis,
// affichée juste avant la réponse finale pour transparence totale.
// ---------------------------------------------------------------------------
function ActionsRecap({ runId }: { runId: string }) {
  const [rows, setRows] = useState<ToolRunRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("agent_tool_runs")
        .select("id, tool_name, succeeded, duration_ms, created_at")
        .eq("agent_run_id", runId)
        .order("created_at", { ascending: true })
        .limit(50);
      if (!cancelled && data) setRows(data as ToolRunRow[]);
    })();
    return () => { cancelled = true; };
  }, [runId]);

  // Agrégation par tool_name : nb d'appels + durée totale + succès/échec
  const grouped = rows.reduce<Record<string, { count: number; totalMs: number; ok: number; ko: number }>>(
    (acc, r) => {
      const k = r.tool_name;
      if (!acc[k]) acc[k] = { count: 0, totalMs: 0, ok: 0, ko: 0 };
      acc[k].count += 1;
      acc[k].totalMs += r.duration_ms ?? 0;
      if (r.succeeded === false) acc[k].ko += 1;
      else if (r.succeeded === true) acc[k].ok += 1;
      return acc;
    },
    {},
  );
  const entries = Object.entries(grouped);
  if (entries.length === 0) return null;

  const totalMs = entries.reduce((sum, [, v]) => sum + v.totalMs, 0);
  const totalCalls = entries.reduce((sum, [, v]) => sum + v.count, 0);

  return (
    <details className="rounded-lg border border-border/40 bg-muted/30 px-4 py-3 group" open>
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Actions effectuées
          </span>
          <span className="text-[11px] text-muted-foreground">
            · {totalCalls} {totalCalls > 1 ? "étapes" : "étape"}
            {totalMs > 0 ? ` · ${totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`}` : ""}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground group-open:hidden">Afficher</span>
        <span className="text-[11px] text-muted-foreground hidden group-open:inline">Masquer</span>
      </summary>
      <ul className="mt-2.5 space-y-1.5">
        {entries.map(([name, v]) => {
          const { label, emoji } = humanizeTool(name);
          return (
            <li key={name} className="flex items-center gap-2 text-xs">
              <span className="text-sm leading-none">{emoji}</span>
              <span className="flex-1 truncate text-foreground/90">
                {label}
                {v.count > 1 ? (
                  <span className="ml-1.5 text-muted-foreground">×{v.count}</span>
                ) : null}
              </span>
              {v.ko > 0 ? (
                <span className="text-[10px] text-destructive">
                  {v.ko} échec{v.ko > 1 ? "s" : ""}
                </span>
              ) : null}
              {v.totalMs > 0 ? (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {v.totalMs < 1000 ? `${v.totalMs}ms` : `${(v.totalMs / 1000).toFixed(1)}s`}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function AgentProgressStepper({ status }: { status: string }) {
  // Mapping états techniques → indice d'étape courant (0..3)
  const activeIndex =
    status === "pending" ? 0 : status === "running" ? 1 : status === "ready" ? 3 : 0;

  const steps = [
    { label: "Comprendre la demande", hint: "analyse de l'intention" },
    { label: "Chercher les sources", hint: "base juridique + documents" },
    { label: "Rédiger la réponse", hint: "synthèse argumentée" },
    { label: "Finaliser", hint: "vérification & mise en forme" },
  ];

  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          L'agent travaille
        </p>
      </div>
      <ol className="space-y-2.5">
        {steps.map((s, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <li key={i} className="flex items-start gap-3">
              <span
                className={cn(
                  "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold mt-0.5 transition-colors",
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-sm leading-tight",
                    active
                      ? "font-medium text-foreground"
                      : done
                        ? "text-muted-foreground line-through decoration-emerald-500/50"
                        : "text-muted-foreground",
                  )}
                >
                  {s.label}
                  {active ? (
                    <span className="ml-1.5 inline-flex gap-0.5 align-middle">
                      <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />
                      <span className="h-1 w-1 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
                      <span className="h-1 w-1 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground/80">{s.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// WorkflowRuntimeBlock est désormais factorisé dans
// `src/components/agent/WorkflowRuntimeBlock.tsx` et réutilisé partout
// (page Agent 360, /chat via WorkflowView, /mes-demandes/$id).

// ---------------------------------------------------------------------------
// FollowUpThread — affiche les questions de suivi liées à une réponse
// (parent_run_id) et propose un input pour en poser de nouvelles. Garde le
// fil conversationnel sans complexifier la machine à états.
// ---------------------------------------------------------------------------
type ChildRun = {
  id: string;
  message: string;
  status: string;
  answer: string | null;
  sources: Array<{ title: string; reference?: string; url?: string }> | null;
  created_at: string;
  error_message: string | null;
  refused: boolean | null;
  refusal_reason: string | null;
  confidence: number | null;
};

function FollowUpThread({
  parentId,
  dossierId,
  onChanged,
}: {
  parentId: string;
  dossierId: string | null;
  onChanged: () => void;
}) {
  const list = useServerFn(listChildRuns);
  const create = useServerFn(createAgentRun);
  const process = useServerFn(processAgentRun);
  const execute = useServerFn(executeAgentRun);

  const [children, setChildren] = useState<ChildRun[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reload = async () => {
    try {
      const rows = (await list({ data: { parent_id: parentId } })) as unknown as ChildRun[];
      setChildren(rows);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void reload();
    const channel = supabase
      .channel(`agent_runs_children:${parentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_runs", filter: `parent_run_id=eq.${parentId}` },
        () => { void reload(); },
      )
      .subscribe();
    // Polling allégé : 20s (Realtime gère les mises à jour rapides)
    const interval = setInterval(reload, 20000);
    return () => {
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId]);

  const ask = async () => {
    const text = followUp.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setFollowUp("");
    try {
      const created = (await create({
        data: {
          message: text,
          parent_run_id: parentId,
          dossier_id: dossierId ?? undefined,
        },
      })) as { id: string };
      await reload();
      try {
        const r1 = (await process({ data: { id: created.id } })) as { status: string };
        if (r1.status === "ready") await execute({ data: { id: created.id } });
      } catch (e) {
        console.error(e);
      }
      await reload();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
      setFollowUp(text);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id={`follow-up-${parentId}`} className="space-y-3 pt-2">
      {children.length > 0 ? (
        <div className="space-y-3 pl-3 border-l-2 border-primary/20">
          {children.map((c) => (
            <div key={c.id} className="space-y-2">
              <div className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground/80">Question de suivi · </span>
                {new Date(c.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
              </div>
              <p className="text-sm font-medium">{c.message}</p>
              {c.answer ? (
                <div className="rounded-md bg-background border border-border/50 p-3">
                  <div className="prose prose-sm max-w-none dark:prose-invert text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.answer}</ReactMarkdown>
                  </div>
                  {c.sources && c.sources.length > 0 ? (
                    <details className="text-xs mt-2">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Sources ({c.sources.length})
                      </summary>
                      <ul className="mt-1 space-y-0.5 pl-4">
                        {c.sources.map((s, i) => (
                          <li key={i} className="text-muted-foreground">
                            [{i + 1}]{" "}
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
                    </details>
                  ) : null}
                </div>
              ) : c.refused && c.refusal_reason ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-muted-foreground">
                  {c.refusal_reason}
                </div>
              ) : c.status === "failed" ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  {c.error_message ?? "Erreur"}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  L'agent prépare la réponse…
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2 pt-1">
        <Input
          id={`follow-up-input-${parentId}`}
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
          placeholder="Préciser, compléter, ou poser une question de suivi…"
          disabled={submitting}
          className="text-sm bg-background"
        />
        <Button size="sm" onClick={ask} disabled={submitting || !followUp.trim()}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourcesList — affiche les sources de manière visible (3 premières) avec
// possibilité de tout déplier. Renforce la confiance utilisateur.
// ---------------------------------------------------------------------------
function SourcesList({
  sources,
}: {
  sources: Array<{ title: string; reference?: string; url?: string }>;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? sources : sources.slice(0, 3);
  return (
    <>
      <ul className="space-y-1.5">
        {visible.map((s, i) => (
          <li key={i} className="flex gap-2 text-xs text-muted-foreground">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-muted font-semibold text-foreground/70 text-[10px]">
              {i + 1}
            </span>
            <span className="flex-1 leading-relaxed">
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground/90 underline-offset-2 hover:underline hover:text-primary"
                >
                  {s.title}
                </a>
              ) : (
                <span className="text-foreground/90">{s.title}</span>
              )}
              {s.reference ? (
                <span className="text-muted-foreground"> — {s.reference}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {sources.length > 3 ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-[11px] font-medium text-primary hover:underline"
        >
          {showAll ? "Réduire" : `Voir les ${sources.length - 3} autres sources`}
        </button>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bandeau de mode — explique le mode (document / procedure / dossier_selection)
// ---------------------------------------------------------------------------
function ModeBanner({ mode }: { mode?: "chat" | "document" | "procedure" | "dossier_selection" }) {
  if (!mode || mode === "chat") return null;
  const meta: Record<string, { title: string; sub: string; emoji: string; tone: string }> = {
    document: {
      emoji: "📝",
      title: "Mode rédaction de document",
      sub: "L'agent prépare un document personnalisé. Répondez aux précisions demandées pour obtenir la version finale.",
      tone: "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
    },
    procedure: {
      emoji: "🧭",
      title: "Mode procédure pas-à-pas",
      sub: "L'agent va dérouler les étapes officielles à suivre. Vous validerez chaque jalon sensible.",
      tone: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
    },
    dossier_selection: {
      emoji: "📁",
      title: "Plusieurs dossiers correspondent",
      sub: "Choisissez le dossier auquel rattacher cette demande pour garder un fil cohérent.",
      tone: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    },
  };
  const m = meta[mode];
  if (!m) return null;
  return (
    <div className={cn("rounded-xl border p-4 flex items-start gap-3", m.tone)}>
      <span className="text-xl leading-none">{m.emoji}</span>
      <div className="min-w-0">
        <p className="font-medium text-sm">{m.title}</p>
        <p className="text-xs opacity-80 mt-0.5">{m.sub}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sélection de dossier — carte multi-choix lue depuis draft.routing.candidates
// ---------------------------------------------------------------------------
function DossierSelectionPanel({
  runId,
  onAttached,
}: {
  runId: string;
  onAttached: () => void;
}) {
  const get = useServerFn(getAgentRun);
  const attach = useServerFn(attachRunToDossier);
  const navigate = useNavigate({ from: "/_authenticated/agent" });
  const [candidates, setCandidates] = useState<
    Array<{ id: string; title: string; category: string | null }> | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attachedId, setAttachedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = (await get({ data: { id: runId } })) as Record<string, unknown>;
        if (cancelled) return;
        const draft = (r.draft as Record<string, unknown>) ?? {};
        const routing = draft.routing as
          | { target?: string; candidates?: Array<{ id: string; title: string; category: string | null }> }
          | null;
        setCandidates(routing?.candidates ?? []);
        setAttachedId((r.dossier_id as string | null) ?? null);
      } catch (e) {
        console.error(e);
        setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, get]);

  if (candidates === null) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Recherche des dossiers correspondants…
        </CardContent>
      </Card>
    );
  }

  if (candidates.length === 0) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Aucun dossier candidat. La demande sera traitée sans rattachement —
          vous pourrez la relier plus tard depuis la fiche dossier.
        </CardContent>
      </Card>
    );
  }

  const choose = async (id: string) => {
    setBusyId(id);
    try {
      await attach({ data: { run_id: runId, dossier_id: id } });
      setAttachedId(id);
      onAttached();
      toast.success("Demande rattachée au dossier");
      void navigate({ to: "/dossiers/$id", params: { id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Choisissez le dossier
          </p>
          <button
            type="button"
            onClick={() => void navigate({ search: { run: runId, mode: undefined } })}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Continuer sans rattacher
          </button>
        </div>
        <ul className="grid sm:grid-cols-2 gap-2">
          {candidates.map((d) => {
            const isAttached = attachedId === d.id;
            const isBusy = busyId === d.id;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => void choose(d.id)}
                  disabled={busyId !== null}
                  className={cn(
                    "w-full text-left rounded-lg border p-3 transition group",
                    isAttached
                      ? "border-emerald-500/50 bg-emerald-500/5"
                      : "border-border/60 bg-background hover:border-primary/40 hover:bg-accent/30",
                    busyId !== null && !isBusy && "opacity-50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm leading-snug truncate">{d.title}</p>
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
                    ) : isAttached ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                    ) : null}
                  </div>
                  {d.category ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">{d.category}</p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
