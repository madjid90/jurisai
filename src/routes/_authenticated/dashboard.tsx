import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles,
  Bell,
  FolderOpen,
  ArrowRight,
  AlertTriangle,
  Clock,
  Loader2,
  Send,
  Paperclip,
  FileSignature,
  Search,
  Workflow,
  ShieldAlert,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  getDashboardSummary,
  type DashboardSummary,
} from "@/server/dashboard.functions";
import { createAgentRun } from "@/server/agent-runs.functions";
import { runOcrDocument } from "@/server/ocr.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Accueil · JurisAI" }] }),
  component: DashboardPage,
});

function fmtDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return d;
  }
}

function fmtRelative(d: string | null) {
  if (!d) return "";
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} j`;
  if (days < 30) return `il y a ${Math.floor(days / 7)} sem`;
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

const SUGGESTIONS = [
  { label: "Analyser un contrat", icon: FileSignature, prompt: "Analyse ce contrat et identifie les risques et clauses sensibles." },
  { label: "Lancer une procédure", icon: Workflow, prompt: "Aide-moi à lancer une procédure : " },
  { label: "Rechercher un dossier", icon: Search, prompt: "Retrouve le dossier concernant " },
  { label: "Vérifier une obligation", icon: ShieldAlert, prompt: "Quelles sont mes obligations légales sur " },
];

function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const create = useServerFn(createAgentRun);
  const ocr = useServerFn(runOcrDocument);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    getDashboardSummary()
      .then((s) => alive && setSummary(s))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const firstName = profile?.full_name?.split(" ")[0] ?? "";

  const handleAsk = async () => {
    if (!message.trim() && files.length === 0) return;
    setSubmitting(true);
    const text = message.trim() || `Analyse du document : ${files.map((f) => f.name).join(", ")}`;
    try {
      let attachments: Array<{ analysis_id: string; filename: string }> = [];
      if (files.length > 0) {
        toast.info("Analyse du document…");
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth.user?.id;
        if (!userId) throw new Error("Session expirée");
        for (const file of files) {
          const path = `${userId}/agent/${Date.now()}-${file.name}`;
          const up = await supabase.storage.from("dossier-files").upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });
          if (up.error) throw new Error(up.error.message);
          const r = (await ocr({
            data: { storage_path: path, filename: file.name, file_type: file.type || "application/octet-stream" },
          })) as { id: string };
          attachments.push({ analysis_id: r.id, filename: file.name });
        }
      }
      const created = (await create({ data: { message: text, attachments } })) as { id: string };
      navigate({ to: "/agent", search: { run: created.id } as never });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la demande");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        {/* Hero — chat box (centré, sans fond) */}
        <section className="relative overflow-hidden rounded-3xl px-2 py-8 sm:py-12">
          <div className="pointer-events-none absolute left-1/2 top-0 h-56 w-56 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Bonjour{firstName ? ` ${firstName}` : ""},
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
              Que puis-je faire pour vous&nbsp;?
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Posez votre question, joignez un contrat ou décrivez la procédure à lancer.
              JurisAI s'occupe du reste et classe tout dans le bon dossier.
            </p>

            {/* Chat input */}
            <div className="mt-6 w-full rounded-2xl border border-border bg-background/70 p-3 shadow-sm backdrop-blur focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleAsk();
                  }
                }}
                placeholder="Posez votre question juridique ou déposez un document…"
                rows={2}
                className="min-h-[60px] resize-none border-0 bg-transparent p-1 text-left text-[15px] focus-visible:ring-0"
              />
              {files.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {files.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs">
                      <Paperclip className="h-3 w-3" /> {f.name}
                      <button
                        onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                        className="ml-1 text-muted-foreground hover:text-foreground"
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Joindre un document
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    if (list.length) setFiles((p) => [...p, ...list]);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={handleAsk}
                  disabled={submitting || (!message.trim() && files.length === 0)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Demander
                </button>
              </div>
            </div>

            {/* Suggestions */}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setMessage(s.prompt)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-soft-foreground backdrop-blur transition hover:border-accent/60 hover:bg-accent hover:text-accent-foreground"
                >
                  <s.icon className="h-3.5 w-3.5 text-accent-soft-foreground" />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Dossiers à suivre — JURIDIQUE */}
        <section className="glass-panel rounded-3xl p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Dossiers à suivre</h2>
            <Link to="/dossiers" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Tout voir <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <SubHeader>Juridique</SubHeader>
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-secondary/50" />
              ))}
            </div>
          ) : !summary?.recent_dossiers.length ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <FolderOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Aucun dossier. Posez votre première question ci-dessus, JurisAI créera le dossier automatiquement.
              </p>
            </div>
          ) : (
            <DossierList dossiers={summary.recent_dossiers.slice(0, 8)} />
          )}
        </section>

        {/* Échéances contrats — Juridique puis Fournisseurs (empilés) */}
        <section className="glass-panel rounded-3xl p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Échéances contrats</h2>
            <Link to="/dossiers" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Tout voir <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <SubHeader>Juridique</SubHeader>
          {loading ? (
            <div className="h-12 animate-pulse rounded-xl bg-secondary/50" />
          ) : !summary?.contract_deadlines.juridique.length ? (
            <EmptyDeadlines text="Aucune échéance contractuelle juridique." />
          ) : (
            <DeadlineList items={summary.contract_deadlines.juridique} />
          )}

          <div className="mt-6">
            <SubHeader>Fournisseurs</SubHeader>
            {loading ? (
              <div className="h-12 animate-pulse rounded-xl bg-secondary/50" />
            ) : !summary?.contract_deadlines.fournisseur.length ? (
              <EmptyDeadlines text="Aucune échéance fournisseur à venir." />
            ) : (
              <DeadlineList items={summary.contract_deadlines.fournisseur} />
            )}
          </div>
        </section>

        {/* Stats compactes */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            icon={<FolderOpen className="h-5 w-5" />}
            label="Dossiers ouverts"
            value={summary?.counters.open_dossiers ?? 0}
            loading={loading}
            to="/dossiers"
          />
          <StatCard
            icon={<Clock className="h-5 w-5" />}
            label="À traiter aujourd'hui"
            value={summary?.to_treat_today.length ?? 0}
            loading={loading}
            to="/dossiers"
          />
          <StatCard
            icon={<Bell className="h-5 w-5" />}
            label="Alertes veille"
            value={summary?.counters.unread_alerts ?? 0}
            loading={loading}
            to="/veille"
          />
        </section>

        {/* Échéances + Veille */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="glass-panel rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Prochaines échéances</h2>
              <Link to="/dossiers" className="text-xs text-primary hover:underline">Tout voir</Link>
            </div>
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : !summary?.to_treat_today.length ? (
              <p className="text-sm text-muted-foreground">Rien d'urgent. Tout est à jour.</p>
            ) : (
              <ul className="divide-y divide-border">
                {summary.to_treat_today.slice(0, 5).map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-3">
                    <Clock className="h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(d.due_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass-panel rounded-3xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Veille juridique</h2>
              <Link to="/veille" className="text-xs text-primary hover:underline">Ouvrir</Link>
            </div>
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : !summary?.legal_alerts.length ? (
              <p className="text-sm text-muted-foreground">Aucune alerte récente.</p>
            ) : (
              <ul className="divide-y divide-border">
                {summary.legal_alerts.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-start gap-3 py-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      {a.legal_date && (
                        <p className="text-xs text-muted-foreground">{fmtDate(a.legal_date)}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

type DossierItem = DashboardSummary["recent_dossiers"][number];

function statusLabel(status: string | null): { label: string; tone: string } {
  switch (status) {
    case "closed": return { label: "Clôturé", tone: "bg-muted text-muted-foreground" };
    case "in_progress": return { label: "En cours", tone: "bg-blue-500/10 text-blue-700 dark:text-blue-400" };
    case "blocked": return { label: "Bloqué", tone: "bg-red-500/10 text-red-700 dark:text-red-400" };
    case "waiting": return { label: "En attente", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" };
    default: return { label: "Ouvert", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" };
  }
}

function riskLabel(risk: string | null): { label: string; tone: string } | null {
  if (!risk || risk === "low" || risk === "none") return null;
  if (risk === "critical") return { label: "Critique", tone: "bg-red-500/15 text-red-700 dark:text-red-400" };
  if (risk === "high") return { label: "Élevé", tone: "bg-red-500/10 text-red-700 dark:text-red-400" };
  if (risk === "medium") return { label: "Moyen", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" };
  return { label: risk, tone: "bg-secondary text-foreground/70" };
}

function DossierList({ dossiers }: { dossiers: DossierItem[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* Header (desktop) */}
      <div className="hidden grid-cols-[1.4fr_1fr_0.7fr_0.7fr_0.6fr] gap-3 border-b border-border bg-secondary/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Personne / objet</span>
        <span>Procédure</span>
        <span>Risque</span>
        <span>État</span>
        <span className="text-right">Maj</span>
      </div>
      <ul className="divide-y divide-border">
        {dossiers.map((d) => {
          const st = statusLabel(d.status);
          const rk = riskLabel(d.risk_level);
          return (
            <li key={d.id}>
              <Link
                to="/dossiers/$id"
                params={{ id: d.id }}
                className="grid grid-cols-1 gap-2 px-4 py-3 transition hover:bg-secondary/40 sm:grid-cols-[1.4fr_1fr_0.7fr_0.7fr_0.6fr] sm:items-center sm:gap-3"
              >
                {/* Personne / objet */}
                <div className="flex min-w-0 items-center gap-2">
                  <FolderOpen className="h-4 w-4 shrink-0 text-primary/70" />
                  <span className="truncate text-sm font-medium">{d.title}</span>
                </div>
                {/* Procédure */}
                <div className="min-w-0 text-xs text-muted-foreground">
                  <span className="sm:hidden font-semibold text-foreground/60">Procédure : </span>
                  <span className="capitalize">{d.category ?? "—"}</span>
                </div>
                {/* Risque */}
                <div>
                  {rk ? (
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-medium ${rk.tone}`}>
                      {rk.label}
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">—</span>
                  )}
                </div>
                {/* État */}
                <div>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-medium ${st.tone}`}>
                    {st.label}
                  </span>
                </div>
                {/* Maj */}
                <div className="text-[11px] text-muted-foreground sm:text-right">
                  {fmtRelative(d.updated_at)}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  loading: boolean;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="glass-panel group flex items-center gap-4 rounded-2xl p-4 transition hover:shadow-md"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : value}
        </p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
    </Link>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function EmptyDeadlines({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center">
      <Clock className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

type DeadlineItem = DashboardSummary["contract_deadlines"]["juridique"][number];

function daysUntil(iso: string): number {
  const d = new Date(iso).getTime();
  return Math.ceil((d - Date.now()) / 86400000);
}

function deadlineToneFor(days: number): { label: string; tone: string } {
  if (days < 0) return { label: `En retard`, tone: "bg-red-500/15 text-red-700 dark:text-red-400" };
  if (days <= 30) return { label: `${days} j`, tone: "bg-red-500/10 text-red-700 dark:text-red-400" };
  if (days <= 90) return { label: `${days} j`, tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" };
  return { label: `${days} j`, tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" };
}

function categoryLabel(c: string | null): string {
  switch (c) {
    case "renouvellement": return "Renouvellement";
    case "fin_contrat": return "Fin de contrat";
    case "paiement": return "Paiement";
    case "fournisseur": return "Fournisseur";
    case "autre": return "Autre";
    default: return c ?? "—";
  }
}

function DeadlineList({ items }: { items: DeadlineItem[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="hidden grid-cols-[1.6fr_0.8fr_0.6fr_0.6fr_0.8fr] gap-3 border-b border-border bg-secondary/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Contrat / objet</span>
        <span>Type</span>
        <span>Date</span>
        <span>Délai</span>
        <span className="text-right">Dossier</span>
      </div>
      <ul className="divide-y divide-border">
        {items.map((d) => {
          const days = daysUntil(d.due_date);
          const tone = deadlineToneFor(days);
          const content = (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <FileSignature className="h-4 w-4 shrink-0 text-primary/70" />
                <span className="truncate text-sm font-medium">{d.label}</span>
              </div>
              <div className="min-w-0 text-xs text-muted-foreground">
                <span className="sm:hidden font-semibold text-foreground/60">Type : </span>
                {categoryLabel(d.category)}
              </div>
              <div className="text-xs text-muted-foreground">{fmtDate(d.due_date)}</div>
              <div>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-medium ${tone.tone}`}>
                  {tone.label}
                </span>
              </div>
              <div className="truncate text-[11px] text-muted-foreground sm:text-right">
                {d.dossier_title ?? "—"}
              </div>
            </>
          );
          return (
            <li key={d.id}>
              {d.dossier_id ? (
                <Link
                  to="/dossiers/$id"
                  params={{ id: d.dossier_id }}
                  className="grid grid-cols-1 gap-2 px-4 py-3 transition hover:bg-secondary/40 sm:grid-cols-[1.6fr_0.8fr_0.6fr_0.6fr_0.8fr] sm:items-center sm:gap-3"
                >
                  {content}
                </Link>
              ) : (
                <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[1.6fr_0.8fr_0.6fr_0.6fr_0.8fr] sm:items-center sm:gap-3">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
