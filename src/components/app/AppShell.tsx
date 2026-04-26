import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Home,
  MessageSquare,
  Bell,
  FileText,
  FolderOpen,
  Users,
  Settings,
  LogOut,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { JurisAIWordmark } from "@/components/brand/JurisAILogo";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Accueil", icon: Home },
  { to: "/chat", label: "Assistant IA", icon: MessageSquare },
  { to: "/dashboard", label: "Veille juridique", icon: Bell, soon: true },
  { to: "/dashboard", label: "Documents", icon: FileText, soon: true },
  { to: "/dashboard", label: "Dossiers", icon: FolderOpen, soon: true },
] as const;

const SECONDARY_ITEMS = [
  { to: "/dashboard", label: "Équipe", icon: Users, soon: true },
  { to: "/dashboard", label: "Paramètres", icon: Settings, soon: true },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mesh-bg flex min-h-screen p-3">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col gap-3 pl-3">{children}</main>
    </div>
  );
}

function Sidebar() {
  const router = useRouter();
  const currentPath = router.state.location.pathname;

  return (
    <aside className="glass-panel flex w-[244px] flex-shrink-0 flex-col rounded-3xl p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center px-2 py-1.5">
        <JurisAIWordmark />
      </div>

      <div className="my-4 h-px w-full bg-border" />

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item, i) => (
          <NavItem
            key={`${item.label}-${i}`}
            label={item.label}
            icon={item.icon}
            to={item.to}
            active={currentPath === item.to}
            soon={"soon" in item ? item.soon : undefined}
          />
        ))}
      </nav>

      <div className="mt-7 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Workspace
      </div>
      <nav className="mt-2 flex flex-col gap-1">
        {SECONDARY_ITEMS.map((item) => (
          <NavItem key={item.label} label={item.label} icon={item.icon} to={item.to} soon={item.soon} />
        ))}
      </nav>

      <div className="mt-auto pt-6">
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

  const handleSignOut = async () => {
    await signOut();
    void navigate({ to: "/" });
  };

  const initials = (profile?.full_name ?? user?.email ?? "?")
    .split(" ")
    .map((s) => s[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("") || "?";

  return (
    <div className="relative">
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
