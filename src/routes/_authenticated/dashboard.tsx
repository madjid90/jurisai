// /dashboard — tableau de bord pur (KPI + dossiers + échéances + veille).
// L'entrée IA a été supprimée : tout passe désormais par /chat (route unifiée).
// On garde ici uniquement un CTA bien visible vers /chat en haut de page.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bell,
  FolderOpen,
  ArrowRight,
  AlertTriangle,
  Clock,
  Loader2,
  FileSignature,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ProductTour } from "@/components/onboarding/ProductTour";
import {
  getDashboardSummary,
  type DashboardSummary,
} from "@/server/dashboard.functions";

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

function DashboardPage() {
  const { profile } = useAuth();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <AppShell>
      <ProductTour />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        {/* Header + CTA "Nouvelle conversation IA" */}
        <section className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-primary/5 via-background to-accent/5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Bonjour{firstName ? ` ${firstName}` : ""},
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              Voici l'état de vos dossiers
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tout est à jour. Lancez une demande dès que vous en avez besoin.
            </p>
          </div>
          <Link
            to="/chat"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground shadow-sm transition hover:opacity-90"
          >
            <MessageSquare className="h-4 w-4" />
            Nouvelle conversation IA
          </Link>
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
                Aucun dossier pour l'instant. Lancez une conversation depuis le chat, JurisAI créera le dossier automatiquement.
              </p>
              <Link
                to="/chat"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-foreground transition hover:opacity-90"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Ouvrir le chat
              </Link>
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
