import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
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
});

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
