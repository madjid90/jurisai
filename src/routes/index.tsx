import { createFileRoute } from "@tanstack/react-router";
import {
  Search,
  Bell,
  ChevronDown,
  ChevronsLeft,
  Home,
  MessageSquare,
  FileText,
  Scale,
  BookOpen,
  Users,
  Settings,
  Plug,
  ClipboardList,
  Sparkles,
  MoreHorizontal,
  Calendar,
  Clock,
  Folder,
  ArrowUpRight,
  Mic,
  Upload,
  Send,
  ChevronRight,
} from "lucide-react";
import { JurisAIWordmark } from "@/components/brand/JurisAILogo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

// ────────────────────────────────────────────────────────────────────────────────
// Sidebar
// ────────────────────────────────────────────────────────────────────────────────

const PRIMARY_NAV = [
  { label: "Accueil", icon: Home, active: true },
  { label: "Assistant IA", icon: MessageSquare },
  { label: "Contrats", icon: FileText },
  { label: "Jurisprudence", icon: Scale },
  { label: "Documents", icon: BookOpen },
  { label: "Tâches", icon: ClipboardList },
] as const;

const WORKSPACE_NAV = [
  { label: "Clients", icon: Users },
  { label: "Intégrations", icon: Plug },
  { label: "Paramètres", icon: Settings },
] as const;

function Sidebar() {
  return (
    <aside className="glass-panel relative flex w-[244px] flex-shrink-0 flex-col rounded-3xl p-4 shadow-[var(--shadow-card)]">
      {/* Brand */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <JurisAIWordmark />
      </div>

      {/* Collapse handle */}
      <button
        type="button"
        aria-label="Réduire la barre latérale"
        className="absolute right-[-12px] top-[68px] z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-[var(--shadow-soft)] hover:text-foreground"
      >
        <ChevronsLeft className="h-3.5 w-3.5" />
      </button>

      <div className="my-4 h-px w-full bg-border" />

      <nav className="flex flex-col gap-1">
        {PRIMARY_NAV.map((item) => (
          <NavItem key={item.label} {...item} />
        ))}
      </nav>

      <div className="mt-7 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Workspace
      </div>

      <nav className="mt-2 flex flex-col gap-1">
        {WORKSPACE_NAV.map((item) => (
          <NavItem key={item.label} {...item} />
        ))}
      </nav>

      <div className="mt-auto pt-6">
        <div className="rounded-2xl bg-gradient-to-br from-primary to-accent p-4 text-primary-foreground shadow-[var(--shadow-glow)]">
          <Sparkles className="h-5 w-5" />
          <p className="mt-2 text-[13px] font-semibold leading-snug">
            Passez au plan Pro
          </p>
          <p className="mt-1 text-[11px] leading-snug opacity-80">
            Recherches illimitées et IA Claude Sonnet
          </p>
          <button
            type="button"
            className="mt-3 w-full rounded-lg bg-white/15 py-1.5 text-[11px] font-medium backdrop-blur transition hover:bg-white/25"
          >
            Découvrir
          </button>
        </div>
      </div>
    </aside>
  );
}

type NavItemProps = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
};

function NavItem({ label, icon: Icon, active }: NavItemProps) {
  return (
    <button
      type="button"
      className={cn(
        "group flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[13.5px] font-medium transition",
        active
          ? "bg-accent-soft text-accent-soft-foreground"
          : "text-foreground/70 hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon className={cn("h-[17px] w-[17px]", active ? "text-accent" : "text-foreground/60")} />
      <span>{label}</span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Top bar
// ────────────────────────────────────────────────────────────────────────────────

function TopBar() {
  return (
    <div className="flex items-center gap-4">
      <div className="glass-panel flex h-12 flex-1 items-center gap-3 rounded-2xl px-4 shadow-[var(--shadow-soft)]">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Rechercher un dossier, un contrat, une décision…"
          className="flex-1 bg-transparent text-[13.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <kbd className="hidden items-center rounded-md border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">
          ⌘ K
        </kbd>
      </div>

      <button
        type="button"
        aria-label="Notifications"
        className="glass-panel flex h-12 w-12 items-center justify-center rounded-2xl text-foreground/70 shadow-[var(--shadow-soft)] hover:text-foreground"
      >
        <Bell className="h-[18px] w-[18px]" />
      </button>

      <div className="glass-panel flex h-12 items-center gap-3 rounded-2xl pl-2 pr-3 shadow-[var(--shadow-soft)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-[12px] font-semibold text-primary-foreground">
          ML
        </div>
        <div className="hidden text-left leading-tight sm:block">
          <p className="text-[13px] font-semibold text-foreground">Maître Laurent</p>
          <p className="text-[11px] text-muted-foreground">cabinet@laurent.fr</p>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Main column — "Nouvelle requête IA"
// ────────────────────────────────────────────────────────────────────────────────

const QUERY_TABS = [
  { label: "Question juridique", icon: MessageSquare, active: true },
  { label: "Analyser un contrat", icon: FileText },
  { label: "Importer un document", icon: Upload },
] as const;

function NewQueryCard() {
  return (
    <section>
      <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
        Nouvelle requête
      </h1>

      {/* Tabs */}
      <div className="mt-5 flex flex-wrap items-center gap-1 rounded-2xl bg-secondary/60 p-1.5">
        {QUERY_TABS.map((t) => (
          <button
            key={t.label}
            type="button"
            className={cn(
              "flex h-10 flex-1 min-w-[160px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-medium transition",
              t.active
                ? "bg-accent-soft text-accent-soft-foreground shadow-[var(--shadow-soft)]"
                : "text-foreground/60 hover:text-foreground",
            )}
          >
            <t.icon className={cn("h-4 w-4", t.active && "text-accent")} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Composer */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-start gap-3">
          <textarea
            placeholder="Posez votre question juridique… Ex : « Quelles sont les conditions de validité d'une clause de non-concurrence en droit du travail ? »"
            rows={3}
            className="flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="button"
            aria-label="Dictée vocale"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground/70 hover:text-foreground"
          >
            <Mic className="h-[17px] w-[17px]" />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <SelectorChip label="Domaine" value="Droit du travail" />
            <SelectorChip label="Sources" value="Légifrance + Judilibre" />
            <SelectorChip label="Modèle" value="GPT-4o" />
          </div>

          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-5 text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
          >
            <Send className="h-4 w-4" />
            Lancer la recherche
          </button>
        </div>
      </div>
    </section>
  );
}

function SelectorChip({ label, value }: { label: string; value: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-secondary/60 px-3 text-[12.5px] font-medium text-foreground/80 hover:bg-secondary"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Recent files
// ────────────────────────────────────────────────────────────────────────────────

const RECENT_CASES = [
  {
    title: "Affaire SARL Dubois — Licenciement",
    date: "Lun. 22 avril 2026",
    duration: "12 pièces",
    summary:
      "Préparation de la requête prud'homale : analyse des motifs de licenciement, identification d'irrégularités procédurales et chiffrage des indemnités.",
    tag: "Droit du travail",
    color: "bg-accent-soft text-accent-soft-foreground",
    members: 3,
  },
  {
    title: "Contrat de cession — Holding Martin",
    date: "Ven. 19 avril 2026",
    duration: "47 pages",
    summary:
      "Revue complète du SPA : clauses de garantie d'actif/passif, conditions suspensives, mécanismes d'earn-out et représentations & warranties.",
    tag: "M&A",
    color: "bg-secondary text-foreground/70",
    members: 5,
  },
] as const;

function RecentCases() {
  return (
    <section className="mt-8">
      <div className="flex items-end justify-between">
        <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
          Dossiers récents
        </h2>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
        >
          Voir tous les dossiers
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {RECENT_CASES.map((c) => (
          <article
            key={c.title}
            className="group rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition hover:shadow-[var(--shadow-elevated)]"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[14px] font-semibold leading-snug text-foreground">
                {c.title}
              </h3>
              <button
                type="button"
                aria-label="Plus d'actions"
                className="text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2 flex items-center gap-3 text-[11.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {c.date}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {c.duration}
              </span>
            </div>

            <p className="mt-3 line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">
              {c.summary}
            </p>

            <div className="mt-4 flex items-center justify-between">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-medium",
                  c.color,
                )}
              >
                <Folder className="h-3 w-3" />
                {c.tag}
              </span>

              <div className="flex items-center gap-1.5">
                <AvatarStack count={c.members} />
                <span className="text-[11.5px] font-semibold text-accent">{c.members}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AvatarStack({ count }: { count: number }) {
  const colors = [
    "from-accent to-primary",
    "from-primary to-accent",
    "from-accent to-chart-2",
  ];
  return (
    <div className="flex -space-x-1.5">
      {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-6 w-6 rounded-full border-2 border-card bg-gradient-to-br",
            colors[i % colors.length],
          )}
        />
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Right rail — Today
// ────────────────────────────────────────────────────────────────────────────────

const TODAY_AGENDA = [
  {
    title: "Audience prud'homale — Dubois",
    time: "09:30 — 11:00",
    person: "Cour de Paris",
    active: true,
  },
  {
    title: "RDV client — Holding Martin",
    time: "14:00 — 15:00",
    person: "Sophie Martin",
    active: true,
  },
  {
    title: "Signature SPA — Cession",
    time: "16:30 — 17:30",
    person: "Étude notariale",
    active: false,
  },
] as const;

const TODO = [
  "Finaliser les conclusions pour l'audience de demain",
  "Vérifier la jurisprudence Cass. soc. 2024-1245",
  "Envoyer le projet de SPA au client pour relecture",
] as const;

function RightRail() {
  return (
    <aside className="hidden w-[320px] flex-shrink-0 flex-col gap-5 lg:flex">
      <section className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
            Aujourd'hui
          </h2>
          <button
            type="button"
            aria-label="Voir le calendrier"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Calendar className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-foreground">Agenda</h3>
          <button
            type="button"
            className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground/70 hover:bg-secondary/80"
          >
            Tout afficher
          </button>
        </div>

        <ul className="mt-3 flex flex-col gap-3">
          {TODAY_AGENDA.map((m) => (
            <li
              key={m.title}
              className="rounded-xl border border-border/60 bg-background/50 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-foreground">
                    {m.title}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {m.time}
                  </p>
                </div>
                <ToggleSwitch on={m.active} />
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <div className="h-5 w-5 rounded-full bg-gradient-to-br from-accent to-primary" />
                <span className="text-[11.5px] text-muted-foreground">{m.person}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold tracking-tight text-foreground">À faire</h2>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
          >
            Voir tout
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <ul className="mt-3 flex flex-col gap-2">
          {TODO.map((t) => (
            <li
              key={t}
              className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 p-3"
            >
              <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 border-border bg-background" />
              <p className="text-[12.5px] leading-snug text-foreground/80">{t}</p>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={cn(
        "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition",
        on ? "bg-accent" : "bg-border",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition",
          on ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────────

function DashboardPage() {
  return (
    <div className="mesh-bg min-h-screen w-full p-5 lg:p-7">
      <div className="mx-auto flex w-full max-w-[1440px] gap-6">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col gap-6">
          <TopBar />

          <div className="flex min-w-0 flex-1 gap-6">
            <div className="min-w-0 flex-1">
              <NewQueryCard />
              <RecentCases />
            </div>
            <RightRail />
          </div>
        </main>
      </div>
    </div>
  );
}
