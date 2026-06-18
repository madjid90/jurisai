import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  Users,
  Settings,
  LogOut,
  ChevronDown,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  CheckCircle2,
  Plus,
  ShieldAlert,
  MessageSquareText,
} from "lucide-react";
import { listMyRuns } from "@/server/agent-runs.functions";
import { JurisAIWordmark } from "@/components/brand/JurisAILogo";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { QuotaBadge } from "@/components/app/QuotaBadge";
import { NotificationBell } from "@/components/app/NotificationBell";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { useAccess, hasPermission } from "@/lib/auth/useAccess";
import type { UserAccess } from "@/lib/auth/permissions.functions";
import { FormSlideOverProvider } from "@/components/agent/FormSlideOver";

type NavItemDef = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Permission requise (au moins une) — si vide, toujours visible */
  perms?: string[];
};

// Sprint U1 (18/06) — Refonte Sidebar Harvey-style :
// L'agent EST l'app. Tout passe par le chat. La sidebar devient minimale :
//   1. Bouton "+ Nouvelle conversation"
//   2. Historique conversations groupé par date (Aujourd'hui / Hier / Cette semaine / Plus ancien)
//   3. Footer : Paramètres + Avatar
//
// Plus de pages Dossiers / Documents / Validations / Veille dans le menu :
// elles deviennent des résultats d'actions depuis le chat. Le badge "À valider"
// reste visible pour les rôles habilités (DRH/manager) sous forme de chip.
//
// Pour les admins (super_admin/tenant_admin), une seule entrée discrète
// "Administration" donne accès à toutes les pages techniques en sous-menu.

const NAV_ITEMS: NavItemDef[] = [];          // vide — la nav principale = historique conversations
const SECONDARY_ITEMS: NavItemDef[] = [];   // vide — settings en footer direct

function canSee(access: UserAccess, item: NavItemDef): boolean {
  if (!item.perms || item.perms.length === 0) return true;
  if (access.isSuperAdmin || access.isTenantAdmin) return true;
  return item.perms.some((p) => hasPermission(access, p));
}

function isPathActive(currentPath: string, target: string): boolean {
  if (target === "/dashboard") return currentPath === "/dashboard";
  return currentPath === target || currentPath.startsWith(target + "/");
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("jurisai.sidebar.collapsed") === "1";
  });
  const router = useRouter();
  const path = router.state.location.pathname;
  const { access, loading: accessLoading } = useAccess();
  useEffect(() => { setMobileOpen(false); }, [path]);

  // Audit fix : guard client sur les 11 routes admin. Avant, n'importe quel user
  // pouvait taper /admin/* dans l'URL et atteindre une UI cassée (les server fns
  // throw silencieusement). Maintenant : redirect propre vers /dashboard.
  const isAdminRoute = path.startsWith("/admin");
  if (isAdminRoute && !accessLoading && !access.isSuperAdmin && !access.isTenantAdmin) {
    return <AdminAccessDenied />;
  }

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { window.localStorage.setItem("jurisai.sidebar.collapsed", next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  };

  return (
    <FormSlideOverProvider>
    <div className="mesh-bg flex min-h-screen md:p-3">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar collapsed={collapsed} />
      </div>
      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-[280px] overflow-y-auto p-3 md:hidden">
            <Sidebar collapsed={false} />
          </div>
        </>
      )}
      <main className="flex min-w-0 flex-1 flex-col gap-3 md:pl-3">
        <header className="flex items-center gap-2 border-b border-border/40 bg-background/80 px-3 py-2 backdrop-blur md:border-0 md:bg-transparent md:px-0 md:py-0">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-secondary md:hidden"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground md:flex"
            aria-label={collapsed ? "Déplier le menu" : "Replier le menu"}
            title={collapsed ? "Déplier le menu" : "Replier le menu"}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
          <div className="md:hidden">
            <JurisAIWordmark />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block">
              <GlobalSearch />
            </div>
            <NotificationBell />
          </div>
        </header>
        <div className="px-3 pb-3 md:px-0 md:pb-0">{children}</div>
      </main>
    </div>
    </FormSlideOverProvider>
  );
}

// ─── Sidebar Harvey-style ─────────────────────────────────────────────────
// L'agent EST l'app. Sidebar ultra-minimale :
//   1. Wordmark + bouton [+ Nouvelle conversation]
//   2. Historique conversations groupé par date
//   3. Footer : badge "À valider" (si DRH) + Paramètres + UserMenu

type RunSummary = {
  id: string;
  title: string | null;
  message: string;
  status: string;
  intent: string | null;
  created_at: string;
  updated_at: string;
};

function groupRunsByDate(runs: RunSummary[]): Array<{ label: string; runs: RunSummary[] }> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86_400_000);

  const groups: Record<string, RunSummary[]> = {
    "Aujourd'hui": [],
    "Hier": [],
    "7 derniers jours": [],
    "Plus ancien": [],
  };

  for (const r of runs) {
    const d = new Date(r.updated_at);
    if (d >= today) groups["Aujourd'hui"].push(r);
    else if (d >= yesterday) groups["Hier"].push(r);
    else if (d >= sevenDaysAgo) groups["7 derniers jours"].push(r);
    else groups["Plus ancien"].push(r);
  }

  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, runs]) => ({ label, runs }));
}

function ConversationHistory({
  collapsed,
  currentRunId,
}: {
  collapsed: boolean;
  currentRunId: string | null;
}) {
  const listFn = useServerFn(listMyRuns);
  const { profile } = useAuth();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!profile?.onboarded) {
      setLoading(false);
      return;
    }
    try {
      const rows = (await listFn({ data: { limit: 50, scope: "mine" } })) as RunSummary[];
      setRuns(rows);
    } catch (e) {
      console.error("[ConversationHistory] failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000); // refresh discret
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.onboarded]);

  if (collapsed) return null;

  if (loading) {
    return (
      <div className="px-2 py-3 text-[11px] text-muted-foreground/60">Chargement…</div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="px-2 py-6 text-center text-[11.5px] text-muted-foreground/60">
        Aucune conversation pour l’instant.
        <br />
        Posez votre première question →
      </div>
    );
  }

  const groups = groupRunsByDate(runs);

  return (
    <div className="flex-1 overflow-y-auto px-1">
      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
            {g.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {g.runs.map((r) => {
              const isActive = currentRunId === r.id;
              const title =
                r.title?.trim() ||
                r.message?.slice(0, 60).trim() ||
                "Conversation";
              return (
                <Link
                  key={r.id}
                  to="/chat"
                  search={{ run: r.id }}
                  className={cn(
                    "block truncate rounded-md px-2 py-1.5 text-[12.5px] transition",
                    isActive
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                  title={title}
                >
                  {title}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const currentPath = router.state.location.pathname;
  const search = router.state.location.search as { run?: string };
  const currentRunId = search.run ?? null;
  const { access, serviceUnavailable } = useAccess();

  const canSeeValidations =
    access.isSuperAdmin ||
    access.isTenantAdmin ||
    access.roles.some((r) =>
      ["admin", "admin_tenant", "super_admin", "juriste", "manager"].includes(r),
    );

  const canSeeAdmin = access.isSuperAdmin || access.isTenantAdmin;

  return (
    <aside
      className={cn(
        "glass-panel flex h-full flex-shrink-0 flex-col rounded-3xl shadow-[var(--shadow-card)] transition-[width] duration-200",
        collapsed ? "w-[68px] p-2" : "w-full p-3 md:w-[260px]",
      )}
    >
      {/* ─── Header : Wordmark + bouton Nouvelle conversation ─── */}
      <div className={cn("flex items-center py-1.5", collapsed ? "justify-center px-0" : "px-2")}>
        {collapsed ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-sm font-bold text-primary-foreground">
            J
          </div>
        ) : (
          <JurisAIWordmark />
        )}
      </div>

      <div className={cn("mt-3", collapsed ? "px-0" : "px-1")}>
        <Link
          to="/chat"
          search={{}}
          className={cn(
            "group flex items-center justify-center rounded-xl border border-border bg-card/80 font-medium text-foreground transition hover:bg-secondary",
            collapsed ? "h-10 w-full" : "h-10 w-full gap-2 px-3 text-[13px]",
          )}
          title={collapsed ? "Nouvelle conversation" : undefined}
          aria-label="Nouvelle conversation"
        >
          <Plus className="h-4 w-4 flex-shrink-0" />
          {!collapsed && <span>Nouvelle conversation</span>}
        </Link>
      </div>

      {serviceUnavailable && !collapsed && (
        <div className="mt-4 rounded-xl border border-border bg-secondary p-3">
          <p className="text-[12px] font-semibold text-foreground">
            Service d’authentification indisponible
          </p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            La navigation reste disponible, mais les permissions détaillées sont
            temporairement dégradées.
          </p>
        </div>
      )}

      {/* ─── Body : historique conversations ─── */}
      <div className="my-3 h-px w-full bg-border/60" />
      <ConversationHistory collapsed={collapsed} currentRunId={currentRunId} />

      {/* ─── Footer : Validations (si applicable) + Settings + UserMenu ─── */}
      <div className="mt-auto pt-2">
        {canSeeValidations && (
          <Link
            to="/validations"
            className={cn(
              "mb-1 flex items-center rounded-xl text-[13px] font-medium transition",
              collapsed
                ? "h-10 justify-center"
                : "h-10 gap-2.5 px-3",
              isPathActive(currentPath, "/validations")
                ? "bg-amber-50 text-amber-700"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
            title={collapsed ? "À valider" : undefined}
          >
            <ShieldAlert className="h-4 w-4 flex-shrink-0" />
            {!collapsed && <span>À valider</span>}
          </Link>
        )}

        {canSeeAdmin && (
          <Link
            to="/admin/usage"
            className={cn(
              "mb-1 flex items-center rounded-xl text-[13px] font-medium transition",
              collapsed
                ? "h-10 justify-center"
                : "h-10 gap-2.5 px-3",
              currentPath.startsWith("/admin")
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
            title={collapsed ? "Administration" : undefined}
          >
            <Users className="h-4 w-4 flex-shrink-0" />
            {!collapsed && <span>Administration</span>}
          </Link>
        )}

        <Link
          to="/settings"
          className={cn(
            "mb-1 flex items-center rounded-xl text-[13px] font-medium transition",
            collapsed ? "h-10 justify-center" : "h-10 gap-2.5 px-3",
            isPathActive(currentPath, "/settings")
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
          title={collapsed ? "Paramètres" : undefined}
        >
          <Settings className="h-4 w-4 flex-shrink-0" />
          {!collapsed && <span>Paramètres</span>}
        </Link>

        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}

function NavItem({
  label,
  icon: Icon,
  to,
  active,
  soon,
  collapsed,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  active?: boolean;
  soon?: boolean;
  collapsed?: boolean;
}) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "group flex h-10 w-full items-center rounded-xl text-[13.5px] font-medium transition",
        collapsed ? "justify-center px-0" : "gap-3 px-3",
        active
          ? "bg-accent-soft text-accent-soft-foreground"
          : "text-foreground/70 hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon className={cn("h-[17px] w-[17px]", active ? "text-accent" : "text-foreground/60")} />
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && soon && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          bientôt
        </span>
      )}
    </Link>
  );
}

// UpgradeCard supprimé en Sprint U1 — désencombrement.
// Stripe / Upgrade reviendront comme action depuis Settings une fois prêts.

function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    void navigate({ to: "/" });
  };

  const initials = (profile?.full_name ?? user?.email ?? "?")
    .split(" ")
    .map((s) => s[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("") || "?";

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? (profile?.full_name ?? user?.email ?? "Utilisateur") : undefined}
        className={cn(
          "flex w-full items-center rounded-xl border border-border/60 bg-card p-2 text-left transition hover:bg-secondary",
          collapsed ? "justify-center" : "gap-2",
        )}
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-[12px] font-semibold text-primary-foreground">
          {initials}
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-foreground">
                {profile?.full_name ?? user?.email ?? "Utilisateur"}
              </p>
              <p className="truncate text-[10.5px] text-muted-foreground">{user?.email}</p>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border bg-popover p-1.5 shadow-[var(--shadow-elevated)]">
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-secondary"
          >
            <Settings className="h-4 w-4" />
            Paramètres
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-secondary"
          >
            <LogOut className="h-4 w-4" />
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

function AdminAccessDenied() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <ShieldAlert className="h-6 w-6 text-red-700" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Accès réservé</h1>
        <p className="text-sm text-muted-foreground">
          Cette section est réservée aux administrateurs. Si vous pensez devoir y avoir accès,
          contactez un administrateur de votre organisation.
        </p>
        <Link
          to="/dashboard"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
