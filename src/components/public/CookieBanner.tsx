import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, Cookie } from "lucide-react";

const STORAGE_KEY = "jurisai-cookie-consent";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const accept = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "accepted");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  const refuse = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "refused");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-md">
      <div className="glass-panel rounded-2xl border border-border bg-card/95 p-4 shadow-[var(--shadow-elevated)] backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Cookie className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-foreground">
              Cookies essentiels uniquement
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Nous utilisons uniquement des cookies nécessaires au
              fonctionnement du service (authentification, préférences).
              Aucun traceur publicitaire.{" "}
              <Link
                to="/confidentialite"
                className="font-medium text-accent hover:underline"
              >
                En savoir plus
              </Link>
              .
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={refuse}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-[12px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                Refuser
              </button>
              <button
                type="button"
                onClick={accept}
                className="inline-flex h-8 items-center rounded-lg bg-gradient-to-br from-primary to-accent px-3 text-[12px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
              >
                Accepter
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={accept}
            className="flex-shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
