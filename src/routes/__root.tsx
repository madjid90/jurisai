import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { Toaster } from "@/components/ui/sonner";
import { CookieBanner } from "@/components/public/CookieBanner";
import { ConfirmProvider } from "@/components/shared/ConfirmProvider";
import { AppErrorBoundary } from "@/components/shared/AppErrorBoundary";
import { SpeedInsights } from "@vercel/speed-insights/react";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  // Audit fix : afficher l'URL qui a 404 pour pouvoir débugger les liens cassés.
  const currentUrl =
    typeof window !== "undefined" ? window.location.pathname + window.location.search : "?";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page introuvable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Cette page n'existe pas ou a été déplacée.
        </p>
        <p className="mt-3 inline-block max-w-full break-all rounded-md bg-secondary/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
          URL : {currentUrl}
        </p>
        <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retour à l'accueil
          </Link>
          <Link
            to="/chat"
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Ouvrir le chat
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "JurisAI — Assistant juridique IA pour les pros" },
      {
        name: "description",
        content:
          "Votre juriste IA disponible 24/7. Réponses fiables, sourcées, adaptées à votre convention collective.",
      },
      { name: "author", content: "JurisAI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <AuthProvider>
          <ConfirmProvider>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              Aller au contenu principal
            </a>
            <div id="main-content">
              <Outlet />
            </div>
            <Toaster richColors position="top-right" />
            <CookieBanner />
            <SpeedInsights />
          </ConfirmProvider>
        </AuthProvider>
      </AppErrorBoundary>
    </QueryClientProvider>
  );
}
