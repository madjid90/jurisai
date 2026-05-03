import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles,
  Bell,
  FolderOpen,
  ArrowRight,
  Zap,
  ShieldCheck,
  ScanLine,
  AlertTriangle,
  Clock,
  CheckCircle2,
  History,
  Loader2,
  Workflow,
  FileText,
  PenLine,
  FileSearch,
  MessageSquare,
  FolderPlus,
  Link2,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  getDashboardSummary,
  type DashboardSummary,
} from "@/server/dashboard.functions";
import { AuroraOrb } from "@/components/aurora/AuroraOrb";
import { HeroPromptInput } from "@/components/aurora/HeroPromptInput";
import { SuggestionChip } from "@/components/aurora/SuggestionChip";
import { useAccess } from "@/lib/auth/useAccess";
import { getProfileSuggestions } from "@/lib/auth/profileSuggestions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord · JurisAI" }] }),
  component: DashboardPage,
});

function fmtDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d;
  }
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/40",
  high: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  medium: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
};

const RISK_LABEL: Record<string, string> = {
  critical: "Critique",
  high: "Élevé",
  medium: "Moyen",
  low: "Faible",
};

function DashboardPage() {
  const { profile, user } = useAuth();
  const fetchSummary = useServerFn(getDashboardSummary);
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const firstName = (profile?.full_name ?? user?.email ?? "").split(" ")[0] ?? "";

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchSummary({})
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [fetchSummary]);

  const tenant = data?.tenant;
  const quotaPct = tenant
    ? Math.min(100, Math.round((tenant.questions_used / Math.max(1, tenant.quota_questions)) * 100))
    : 0;

  async function handlePromptSubmit(text: string, files: File[]) {
    if (!text && !files.length) return;
    setSubmitting(true);
    try {
      // Si fichiers : router vers /scan pour ingestion + analyse
      if (files.length > 0) {
        void navigate({ to: "/scan" });
        return;
      }
      void navigate({ to: "/agent", search: { q: text } as never });
    } finally {
      setSubmitting(false);
    }
  }

  function quickPrompt(q: string) {
    void navigate({ to: "/agent", search: { q } as never });
  }

  return (
    <AppShell>
      <div className="space-y-8 overflow-y-auto pb-10">
        {/* HERO — Home AI : orb + prompt central + chips */}
        <section className="relative isolate overflow-hidden rounded-3xl border border-border bg-card/60 px-4 py-10 shadow-[var(--shadow-card)] sm:px-8 sm:py-14">
          <div
            className="pointer-events-none absolute inset-0 -z-10 mesh-bg opacity-70"
            aria-hidden
          />

          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
            <AuroraOrb size={140} active={submitting} />

            <div className="space-y-2">
              <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Bonjour {firstName}
              </h1>
              <p className="text-pretty text-[14px] text-muted-foreground sm:text-base">
                Posez votre question, joignez un document, ou choisissez une action.
                <br className="hidden sm:inline" />
                JurisAI comprend, source, propose, prépare, exécute et trace.
              </p>
            </div>

            <HeroPromptInput
              className="w-full max-w-2xl"
              loading={submitting}
              onSubmit={handlePromptSubmit}
              placeholder="Ex : Préparer une rupture conventionnelle pour un cadre embauché en 2019…"
            />

            <div className="flex flex-wrap items-center justify-center gap-2">
              <SuggestionChip
                icon={<PenLine className="h-3.5 w-3.5" />}
                label="Rédiger un contrat"
                onClick={() => quickPrompt("Rédige un contrat ")}
              />
              <SuggestionChip
                icon={<FileSearch className="h-3.5 w-3.5" />}
                label="Analyser un document"
                onClick={() => void navigate({ to: "/scan" })}
              />
              <SuggestionChip
                icon={<MessageSquare className="h-3.5 w-3.5" />}
                label="Demander à l'IA"
                onClick={() => quickPrompt("")}
              />
              <SuggestionChip
                icon={<FolderPlus className="h-3.5 w-3.5" />}
                label="Ouvrir un dossier"
                onClick={() => quickPrompt("Ouvre un nouveau dossier pour ")}
              />
              <SuggestionChip
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="Veille du jour"
                onClick={() => void navigate({ to: "/veille" })}
              />
            </div>
          </div>

          {/* Compteurs */}
          <div className="mx-auto mt-10 grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <CounterCard
              icon={Link2}
              label="Liaisons à valider"
              value={data?.counters.pending_links ?? 0}
              loading={loading}
              to="/links"
              tone={(data?.counters.pending_links ?? 0) > 0 ? "warn" : "neutral"}
            />
            <CounterCard
              icon={FolderOpen}
              label="Dossiers ouverts"
              value={data?.counters.open_dossiers ?? 0}
              loading={loading}
              to="/dossiers"
            />
            <CounterCard
              icon={ShieldCheck}
              label="Validations"
              value={data?.counters.pending_validations ?? 0}
              loading={loading}
              tone={
                (data?.counters.pending_validations ?? 0) > 0 ? "warn" : "neutral"
              }
            />
            <CounterCard
              icon={Clock}
              label="Rappels actifs"
              value={data?.counters.active_reminders ?? 0}
              loading={loading}
            />
            <CounterCard
              icon={Bell}
              label="Alertes (30j)"
              value={data?.counters.unread_alerts ?? 0}
              loading={loading}
              to="/veille"
            />
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-[13px] text-destructive">
            Impossible de charger le tableau de bord : {error}
          </div>
        )}

        {/* Grille widgets */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* À traiter aujourd'hui */}
          <Widget
            icon={AlertTriangle}
            title="À traiter aujourd'hui"
            badge={data?.to_treat_today.length ?? 0}
            tone="warn"
          >
            {loading ? (
              <Skeleton lines={3} />
            ) : !data || data.to_treat_today.length === 0 ? (
              <Empty text="Rien d'urgent. 🎉" />
            ) : (
              <ul className="space-y-2">
                {data.to_treat_today.slice(0, 6).map((item) => (
                  <li
                    key={`${item.kind}-${item.id}`}
                    className="flex items-start gap-2 rounded-lg border border-border bg-background/50 p-2.5"
                  >
                    <span
                      className={`mt-0.5 inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-bold uppercase ${
                        item.kind === "validation"
                          ? "bg-orange-500/10 text-orange-600"
                          : "bg-blue-500/10 text-blue-600"
                      }`}
                    >
                      {item.kind === "validation" ? "Valid." : "Rappel"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-foreground">
                        {item.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmtDate(item.due_at)}
                        {item.dossier_id && (
                          <>
                            {" · "}
                            <Link
                              to="/dossiers/$id"
                              params={{ id: item.dossier_id }}
                              className="text-accent hover:underline"
                            >
                              dossier
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Widget>

          {/* Dossiers récents */}
          <Widget
            icon={FolderOpen}
            title="Dossiers récents"
            badge={data?.recent_dossiers.length ?? 0}
            actionLabel="Tous"
            actionTo="/dossiers"
          >
            {loading ? (
              <Skeleton lines={3} />
            ) : !data || data.recent_dossiers.length === 0 ? (
              <Empty text="Aucun dossier. Créez-en via l'agent." />
            ) : (
              <ul className="space-y-2">
                {data.recent_dossiers.slice(0, 6).map((d) => (
                  <li key={d.id}>
                    <Link
                      to="/dossiers/$id"
                      params={{ id: d.id }}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background/50 p-2.5 transition hover:bg-secondary/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-foreground">
                          {d.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {d.category ?? "—"} · {fmtDate(d.updated_at)}
                        </p>
                      </div>
                      {d.risk_level && d.risk_level !== "low" && (
                        <span
                          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                            SEVERITY_COLOR[d.risk_level] ?? ""
                          }`}
                        >
                          {RISK_LABEL[d.risk_level] ?? d.risk_level}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Widget>

          {/* Validations en attente */}
          <Widget
            icon={ShieldCheck}
            title="Validations en attente"
            badge={data?.pending_validations.length ?? 0}
            tone={
              (data?.pending_validations.length ?? 0) > 0 ? "warn" : "neutral"
            }
          >
            {loading ? (
              <Skeleton lines={2} />
            ) : !data || data.pending_validations.length === 0 ? (
              <Empty text="Aucune décision en attente." />
            ) : (
              <ul className="space-y-2">
                {data.pending_validations.slice(0, 5).map((v) => (
                  <li
                    key={v.id}
                    className="rounded-lg border border-border bg-background/50 p-2.5"
                  >
                    <p className="truncate text-[12.5px] font-medium text-foreground">
                      {v.comment ?? `Validation ${v.subject_type}`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {fmtDate(v.created_at)}
                      {v.dossier_id && (
                        <>
                          {" · "}
                          <Link
                            to="/dossiers/$id"
                            params={{ id: v.dossier_id }}
                            className="text-accent hover:underline"
                          >
                            ouvrir
                          </Link>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Widget>

          {/* Alertes veille */}
          <Widget
            icon={Bell}
            title="Veille juridique"
            badge={data?.legal_alerts.length ?? 0}
            actionLabel="Tout voir"
            actionTo="/veille"
          >
            {loading ? (
              <Skeleton lines={3} />
            ) : !data || data.legal_alerts.length === 0 ? (
              <Empty text="Aucune alerte récente." />
            ) : (
              <ul className="space-y-2">
                {data.legal_alerts.slice(0, 5).map((a) => (
                  <li
                    key={a.id}
                    className="rounded-lg border border-border bg-background/50 p-2.5"
                  >
                    <div className="flex items-start gap-2">
                      {a.severity && (
                        <span
                          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                            SEVERITY_COLOR[a.severity] ?? "bg-secondary text-foreground"
                          }`}
                        >
                          {a.severity}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-foreground">
                          {a.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {a.source_type ?? "—"} · {fmtDate(a.legal_date)}
                          {a.official_url && (
                            <>
                              {" · "}
                              <a
                                href={a.official_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent hover:underline"
                              >
                                source ↗
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Widget>

          {/* Activité agent */}
          <Widget
            icon={History}
            title="Activité agent"
            badge={data?.recent_agent_runs.length ?? 0}
            actionLabel="Agent"
            actionTo="/agent"
          >
            {loading ? (
              <Skeleton lines={3} />
            ) : !data || data.recent_agent_runs.length === 0 ? (
              <Empty text="Lancez votre première requête." />
            ) : (
              <ul className="space-y-2">
                {data.recent_agent_runs.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-border bg-background/50 p-2.5"
                  >
                    <p className="truncate text-[12.5px] font-medium text-foreground">
                      {r.message}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.intent ?? "—"} · {r.domain ?? "—"} · {fmtDate(r.created_at)}
                      {r.refused && (
                        <span className="ml-1 rounded bg-amber-500/10 px-1 text-amber-600">
                          refus
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Widget>

          {/* Quota */}
          <Widget icon={Zap} title="Quota mensuel" actionLabel="Plan" actionTo="/upgrade">
            {!tenant ? (
              <Skeleton lines={2} />
            ) : (
              <>
                <p className="text-[22px] font-bold text-foreground">
                  {tenant.questions_used}
                  <span className="text-[13px] font-medium text-muted-foreground">
                    {" "}
                    / {tenant.quota_questions}
                  </span>
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  questions · plan{" "}
                  <span className="font-semibold capitalize text-foreground">
                    {tenant.plan ?? "—"}
                  </span>
                </p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full rounded-full transition-all ${
                      quotaPct > 90
                        ? "bg-destructive"
                        : "bg-gradient-to-r from-primary to-accent"
                    }`}
                    style={{ width: `${quotaPct}%` }}
                  />
                </div>
              </>
            )}
          </Widget>
        </div>

        {/* Raccourcis rapides */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Raccourcis
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <ShortcutLink to="/dossiers" icon={FolderOpen} label="Dossiers" />
            <ShortcutLink to="/workflows" icon={Workflow} label="Procédures" />
            <ShortcutLink to="/templates" icon={FileText} label="Modèles" />
            <ShortcutLink to="/scan" icon={ScanLine} label="Scanner un document" />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

/* ---------- Sub-components ---------- */

function CounterCard({
  icon: Icon,
  label,
  value,
  loading,
  to,
  tone = "neutral",
}: {
  icon: typeof Bell;
  label: string;
  value: number;
  loading: boolean;
  to?: string;
  tone?: "neutral" | "warn";
}) {
  const content = (
    <div
      className={`rounded-xl border p-3 transition ${
        tone === "warn"
          ? "border-orange-500/30 bg-orange-500/5"
          : "border-border bg-background/50"
      } ${to ? "hover:bg-secondary/40 cursor-pointer" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 text-[20px] font-bold text-foreground">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : value}
      </p>
    </div>
  );
  return to ? (
    <Link to={to}>{content}</Link>
  ) : (
    content
  );
}

function Widget({
  icon: Icon,
  title,
  badge,
  tone = "neutral",
  actionLabel,
  actionTo,
  children,
}: {
  icon: typeof Bell;
  title: string;
  badge?: number;
  tone?: "neutral" | "warn";
  actionLabel?: string;
  actionTo?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon
            className={`h-4 w-4 ${
              tone === "warn" ? "text-orange-600" : "text-accent"
            }`}
          />
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          {typeof badge === "number" && badge > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                tone === "warn"
                  ? "bg-orange-500/15 text-orange-600"
                  : "bg-accent-soft text-accent"
              }`}
            >
              {badge}
            </span>
          )}
        </div>
        {actionTo && actionLabel && (
          <Link
            to={actionTo}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-accent hover:underline"
          >
            {actionLabel}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-background/40 px-3 py-4 text-[12px] text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
      {text}
    </div>
  );
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-lg bg-secondary/40"
        />
      ))}
    </div>
  );
}

function ShortcutLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof Bell;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2.5 text-[13px] font-medium text-foreground transition hover:bg-secondary/40"
    >
      <Icon className="h-4 w-4 text-accent" />
      <span className="flex-1">{label}</span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition group-hover:translate-x-0.5" />
    </Link>
  );
}
