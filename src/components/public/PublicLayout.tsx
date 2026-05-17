import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { JurisAIWordmark } from "@/components/brand/JurisAILogo";
import { Menu, X } from "lucide-react";

const FOOTER_LINKS = [
  { label: "Tarifs", to: "/#pricing" },
  { label: "Mentions légales", to: "/mentions-legales" },
  { label: "CGU", to: "/cgu" },
  { label: "CGV", to: "/cgv" },
  { label: "Confidentialité", to: "/confidentialite" },
];

export function PublicHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

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
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-foreground/70 hover:bg-secondary md:hidden"
            aria-label="Menu de navigation"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile navigation */}
      {mobileOpen && (
        <nav className="border-t border-border/40 bg-background/95 backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-3">
            <a
              href="#features"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-[14px] font-medium text-foreground/80 hover:bg-secondary"
            >
              Fonctionnalités
            </a>
            <a
              href="#use-cases"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-[14px] font-medium text-foreground/80 hover:bg-secondary"
            >
              Cas d'usage
            </a>
            <a
              href="#pricing"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-[14px] font-medium text-foreground/80 hover:bg-secondary"
            >
              Tarifs
            </a>
            <Link
              to="/login"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-[14px] font-medium text-foreground/80 hover:bg-secondary"
            >
              Connexion
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border/60 bg-background/50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        {/* Disclaimer juridique obligatoire (art. 54 loi 1971) */}
        <p className="text-center text-[12px] leading-relaxed text-muted-foreground">
          <strong>Information juridique</strong> — JurisAI fournit une assistance documentaire et opérationnelle automatisée.
          Ses réponses ne constituent pas un conseil juridique au sens de l'article 54 de la loi du 31 décembre 1971 et ne se substituent
          pas à la consultation d'un avocat. Pour toute décision engageant votre responsabilité juridique, consultez un professionnel du droit.
        </p>
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
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
      </div>
    </footer>
  );
}
