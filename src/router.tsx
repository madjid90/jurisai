import { createRouter, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { routeTree } from "./routeTree.gen";

/**
 * Detect "Failed to fetch dynamically imported module" errors.
 * These happen when the user has an old version of the app loaded
 * and the route chunks have been replaced by a new deploy.
 * The only fix is a hard reload.
 */
function isStaleChunkError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", () => {
    window.location.reload();
  });
}


function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const isAuthServiceUnavailable = /AUTH_SERVICE_UNAVAILABLE/i.test(error.message);

  // Auto-reload on stale chunk errors (after a new deploy)
  useEffect(() => {
    if (isStaleChunkError(error) && typeof window !== "undefined") {
      window.location.reload();
    }
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Une erreur est survenue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isAuthServiceUnavailable
            ? "Le service d’authentification est temporairement indisponible. Réessayez dans quelques instants."
            : "Une erreur inattendue s’est produite. Veuillez réessayer."}
        </p>
        {error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Réessayer
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Retour à l'accueil
          </a>
        </div>
      </div>
    </div>
  );
}

function DefaultPendingComponent() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Chargement…</span>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function DefaultNotFoundComponent() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Cette ressource est introuvable.
        </p>
        <a
          href="/"
          className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retour à l'accueil
        </a>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
    defaultPendingComponent: DefaultPendingComponent,
    defaultNotFoundComponent: DefaultNotFoundComponent,
  });

  return router;
};
