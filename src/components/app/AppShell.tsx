import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Home,
  MessageSquare,
  Bell,
  FileText,
  FolderOpen,
  ScanSearch,
  ScanLine,
  Users,
  Settings,
  LogOut,
  ChevronDown,
  Sparkles,
  Database,
  BookMarked,
  Menu,
  X,
  Activity,
  ShieldCheck,
  Workflow,
  ScrollText,
  Library,
  ServerCrash,
} from "lucide-react";
import { JurisAIWordmark } from "@/components/brand/JurisAILogo";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { QuotaBadge } from "@/components/app/QuotaBadge";
import { NotificationBell } from "@/components/app/NotificationBell";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { useAccess, hasPermission } from "@/lib/auth/useAccess";
import type { UserAccess } from "@/server/permissions.functions";

type NavItemDef = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Permission requise (au moins une) — si vide, toujours visible */
  perms?: string[];
};

const NAV_ITEMS: NavItemDef[] = [
  { to: "/dashboard", label: "Accueil", icon: Home },
  { to: "/chat", label: "Assistant IA", icon: MessageSquare, perms: ["ia.ask"] },
  { to: "/agent", label: "Agent IA", icon: Sparkles, perms: ["ia.ask"] },
  { to: "/workflows", label: "Procédures", icon: Workflow, perms: ["workflows.run", "workflows.validate"] },
  { to: "/templates", label: "Modèles", icon: Library, perms: ["documents.generate"] },
  { to: "/scan", label: "OCR & scan", icon: ScanLine, perms: ["documents.upload"] },
  { to: "/documents", label: "Documents", icon: FileText, perms: ["documents.upload", "documents.analyze"] },
  { to: "/analyses", label: "Analyses", icon: ScanSearch, perms: ["documents.analyze"] },
  { to: "/dossiers", label: "Dossiers", icon: FolderOpen, perms: ["dossiers.view"] },
  { to: "/veille", label: "Veille juridique", icon: Bell, perms: ["veille.view"] },
];

const SECONDARY_ITEMS: NavItemDef[] = [
  { to: "/team", label: "Équipe", icon: Users, perms: ["users.manage", "roles.manage"] },
  { to: "/settings", label: "Paramètres", icon: Settings },
];

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
  const router = useRouter();
  const path = router.state.location.pathname;
  // Auto-close drawer on route change
  useEffect(() => { setMobileOpen(false); }, [path]);

  return (
    <div className="mesh-bg flex min-h-screen md:p-3">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>
      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-[280px] overflow-y-auto p-3 md:hidden">
            <Sidebar />
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
  );
}

function Sidebar() {
  const router = useRouter();
  const currentPath = router.state.location.pathname;
  const { access, serviceUnavailable } = useAccess();
  const isSuperAdmin = access.isSuperAdmin;

  // Profil "terrain" = vue ultra-simplifiée
  const isTerrainOnly =
    access.roles.length > 0 &&
    access.roles.every((r) => r === "operationnel_terrain");

  const TERRAIN_PATHS = new Set([
    "/dashboard",
    "/chat",
    "/workflows",
    "/documents",
    "/scan",
  ]);

  const baseNav = isTerrainOnly
    ? NAV_ITEMS.filter((it) => TERRAIN_PATHS.has(it.to))
    : NAV_ITEMS;
  const visibleNav = baseNav.filter((it) => canSee(access, it));
  const visibleSecondary = SECONDARY_ITEMS.filter((it) => canSee(access, it));

  return (
    <aside className="glass-panel flex h-full w-full flex-shrink-0 flex-col rounded-3xl p-4 shadow-[var(--shadow-card)] md:w-[244px]">
      <div className="flex items-center px-2 py-1.5">
        <JurisAIWordmark />
      </div>

      <div className="my-4 h-px w-full bg-border" />

      {serviceUnavailable && (
        <div className="mb-4 rounded-2xl border border-border bg-secondary p-3">
          <p className="text-[12px] font-semibold text-foreground">Service d’authentification indisponible</p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            La navigation reste disponible, mais les permissions détaillées sont temporairement dégradées.
          </p>
        </div>
      )}

      <nav className="flex flex-col gap-1">
        {visibleNav.map((item, i) => (
          <NavItem
            key={`${item.label}-${i}`}
            label={item.label}
            icon={item.icon}
            to={item.to}
            active={isPathActive(currentPath, item.to)}
          />
        ))}
      </nav>

      <div className="mt-7 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Workspace
      </div>
      <nav className="mt-2 flex flex-col gap-1">
        {visibleSecondary.map((item) => (
          <NavItem
            key={item.label}
            label={item.label}
            icon={item.icon}
            to={item.to}
            active={isPathActive(currentPath, item.to)}
          />
        ))}
      </nav>

      {(isSuperAdmin || access.isTenantAdmin) && (
        <>
          <div className="mt-7 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Admin
          </div>
          <nav className="mt-2 flex flex-col gap-1">
            {isSuperAdmin && (
              <>
                <NavItem label="Connecteurs data" icon={Database} to="/admin/connectors" active={currentPath === "/admin/connectors"} />
                <NavItem label="Sources légales" icon={BookMarked} to="/admin/legal-sources" active={currentPath === "/admin/legal-sources"} />
                <NavItem label="Tenants" icon={Users} to="/admin/tenants" active={currentPath === "/admin/tenants"} />
                <NavItem label="Usage" icon={Sparkles} to="/admin/usage" active={currentPath === "/admin/usage"} />
              </>
            )}
            {hasPermission(access, "data_quality.view") && (
              <NavItem label="Qualité données" icon={ShieldCheck} to="/admin/data-quality" active={currentPath === "/admin/data-quality"} />
            )}
            {hasPermission(access, "rag_quality.view") && (
              <NavItem label="Évaluation RAG" icon={Activity} to="/admin/rag-quality" active={currentPath === "/admin/rag-quality"} />
            )}
            {hasPermission(access, "monitoring.view") && (
              <NavItem label="Erreurs serveur" icon={ServerCrash} to="/admin/server-errors" active={currentPath === "/admin/server-errors"} />
            )}
            {hasPermission(access, "audit.view") && (
              <NavItem label="Audit" icon={ScrollText} to="/admin/audit" active={currentPath === "/admin/audit"} />
            )}
          </nav>
        </>
      )}

      <div className="mt-auto pt-6">
        <QuotaBadge />
        <UpgradeCard />
        <UserMenu />
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
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  active?: boolean;
  soon?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[13.5px] font-medium transition",
        active
          ? "bg-accent-soft text-accent-soft-foreground"
          : "text-foreground/70 hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon className={cn("h-[17px] w-[17px]", active ? "text-accent" : "text-foreground/60")} />
      <span className="flex-1">{label}</span>
      {soon && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          bientôt
        </span>
      )}
    </Link>
  );
}

function UpgradeCard() {
  return (
    <div className="mb-3 rounded-2xl bg-gradient-to-br from-primary to-accent p-4 text-primary-foreground shadow-[var(--shadow-glow)]">
      <Sparkles className="h-5 w-5" />
      <p className="mt-2 text-[13px] font-semibold leading-snug">Passez au plan Pro</p>
      <p className="mt-1 text-[11px] leading-snug opacity-80">
        Veille personnalisée et IA illimitée
      </p>
      <button
        type="button"
        className="mt-3 w-full rounded-lg bg-white/15 py-1.5 text-[11px] font-medium backdrop-blur transition hover:bg-white/25"
      >
        Découvrir
      </button>
    </div>
  );
}

function UserMenu() {
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
        className="flex w-full items-center gap-2 rounded-xl border border-border/60 bg-card p-2 text-left transition hover:bg-secondary"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-[12px] font-semibold text-primary-foreground">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-foreground">
            {profile?.full_name ?? user?.email ?? "Utilisateur"}
          </p>
          <p className="truncate text-[10.5px] text-muted-foreground">{user?.email}</p>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
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
