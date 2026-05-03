import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Sparkles,
  Bell,
  FolderOpen,
  ArrowRight,
  AlertTriangle,
  Clock,
  Loader2,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {/* Hero — entrée unique vers l'assistant */}
        <section className="glass-panel rounded-3xl p-8 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">
                Bonjour{firstName ? ` ${firstName}` : ""},
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">
                Que puis-je faire pour vous aujourd'hui&nbsp;?
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Posez votre question, joignez un contrat ou décrivez la procédure
                à lancer. JurisAI s'occupe du reste et classe tout dans le bon dossier.
              </p>
            </div>
            <Sparkles className="h-8 w-8 shrink-0 text-primary" />
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              to="/agent"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              Ouvrir l'assistant <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/dossiers"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-secondary"
            >
              <FolderOpen className="h-4 w-4" /> Mes dossiers
            </Link>
          </div>
        </section>

        {/* Stats rapides */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

        {/* Échéances à venir */}
        <section className="glass-panel rounded-3xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Prochaines échéances</h2>
            <Link to="/dossiers" className="text-xs text-primary hover:underline">
              Tout voir
            </Link>
          </div>
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : !summary?.to_treat_today.length ? (
            <p className="text-sm text-muted-foreground">
              Rien d'urgent. Tout est à jour.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {summary.to_treat_today.slice(0, 5).map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-3">
                  <Clock className="h-4 w-4 shrink-0 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(d.due_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Alertes veille */}
        <section className="glass-panel rounded-3xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Veille juridique</h2>
            <Link to="/veille" className="text-xs text-primary hover:underline">
              Ouvrir la veille
            </Link>
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
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(a.legal_date)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
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
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-2xl font-semibold">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : value}
        </p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
    </Link>
  );
}
