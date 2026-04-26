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

export const Route = createFileRoute("/_authenticated")({
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
    // If profile loaded and not onboarded, redirect to onboarding
    if (profile && !profile.onboarded && !router.state.location.pathname.startsWith("/onboarding")) {
      void navigate({ to: "/onboarding" });
    }
  }, [loading, session, profile, navigate, router.state.location.pathname]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return <Outlet />;
}
