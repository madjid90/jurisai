import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouter,
  Link,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2, AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";

function isTransientAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;

  return (
    (typeof status === "number" && status >= 500) ||
    /unexpected eof|temporarily unavailable|service unavailable|failed to fetch|network/i.test(
      message,
    )
  );
}

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    if (typeof window === "undefined") {
      return;
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error && isTransientAuthError(error)) {
      return;
    }

    if (error || !user) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthenticatedLayout,
  // Audit fix : avant on n'avait que AppErrorBoundary global → 1 crash dans n'importe
  // quelle route enfant cassait toute l'app. Maintenant chaque route hérite d'un
  // errorComponent qui affiche un fallback inline et permet de réessayer / rentrer.
  errorComponent: AuthRouteErrorFallback,
  pendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-accent" />
    </div>
  ),
});

function AuthRouteErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const navigate = useNavigate();
  const isOnboardingError = /Vous devez d'abord compléter l'onboarding|profil introuvable/i.test(error.message);
  const isAuthError = /unauthorized|missing access token|invalid token|forbidden/i.test(error.message);

  // Audit fix : si l'erreur est "pas d'onboarding", on REDIRIGE automatiquement
  // au lieu d'afficher un écran d'erreur. C'est le cas typique d'un user fraîchement
  // inscrit qui n'a pas encore complété /onboarding et qui atterrit sur /dashboard.
  useEffect(() => {
    if (isOnboardingError) {
      void navigate({ to: "/onboarding" });
    }
  }, [isOnboardingError, navigate]);

  if (isOnboardingError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-5 rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle className="h-6 w-6 text-amber-700" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">
            {isAuthError ? "Session interrompue" : "Une erreur est survenue"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAuthError
              ? "Votre session a expiré ou n'est pas encore prête. Réessayez ou reconnectez-vous."
              : "Cette page n'a pas pu se charger. Vous pouvez réessayer ou retourner à l'accueil."}
          </p>
          <p className="mt-3 rounded-md bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground font-mono break-all">
            {error.message.slice(0, 200)}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset} variant="outline" className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> Réessayer
          </Button>
          <Button asChild className="gap-2">
            <Link to="/dashboard">
              <Home className="h-3.5 w-3.5" /> Retour à l'accueil
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuthenticatedLayout() {
  const { session, profile, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      void navigate({ to: "/login" });
      return;
    }
    // Audit fix : NE PAS signOut sur !profile. C'était la cause principale des
    // déconnexions intempestives — fetchProfile peut transitoirement renvoyer
    // null (réseau, RLS, race condition setTimeout 0). On affiche juste un
    // loader (cf. bloc return ci-dessous) et on attend que profile se charge.
    // Si vraiment le profile n'existe pas (user supprimé en DB), AuthProvider
    // détectera l'erreur explicite et déclenchera le logout côté provider.
    if (profile && !profile.onboarded && !router.state.location.pathname.startsWith("/onboarding")) {
      void navigate({ to: "/onboarding" });
    }
  }, [loading, session, profile, navigate, router.state.location.pathname]);

  if (loading || !session || !profile) {
    // Pas de profile = chargement en cours (ou erreur transitoire), pas un logout.
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  // Audit fix : bloquer le render des routes enfants tant que l'onboarding n'est pas fait
  // (sauf si on est déjà sur /onboarding). Avant ce fix : /chat se montait et appelait
  // listMyRuns → getTenantId → Error "Vous devez d'abord compléter l'onboarding".
  if (profile && !profile.onboarded && !router.state.location.pathname.startsWith("/onboarding")) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return <Outlet />;
}
