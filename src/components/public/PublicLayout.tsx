import { Link } from "@tanstack/react-router";
import { JurisAIWordmark } from "@/components/brand/JurisAILogo";

const FOOTER_LINKS = [
  { label: "Tarifs", to: "/#pricing" },
  { label: "Connexion", to: "/login" },
  { label: "Inscription", to: "/signup" },
];

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 w-full">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center">
          <JurisAIWordmark />
        </Link>

        <nav className="hidden items-center gap-7 text-[13.5px] font-medium text-foreground/70 md:flex">
          <a href="#features" className="hover:text-foreground">
            Fonctionnalités
          </a>
          <a href="#use-cases" className="hover:text-foreground">
            Cas d'usage
          </a>
          <a href="#pricing" className="hover:text-foreground">
            Tarifs
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="hidden h-9 items-center rounded-lg px-4 text-[13px] font-medium text-foreground/80 hover:bg-secondary hover:text-foreground sm:inline-flex"
          >
            Connexion
          </Link>
          <Link
            to="/signup"
            className="inline-flex h-9 items-center rounded-lg bg-gradient-to-br from-primary to-accent px-4 text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
          >
            Essayer gratuitement
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border/60 bg-background/50">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <JurisAIWordmark className="scale-90" />
          <span className="ml-2">© {new Date().getFullYear()} JurisAI · Tous droits réservés</span>
        </div>
        <nav className="flex items-center gap-5 text-[12.5px] text-muted-foreground">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
