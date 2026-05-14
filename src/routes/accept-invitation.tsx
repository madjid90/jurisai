import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2, AlertCircle, Mail } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { acceptInvitation } from "@/lib/server-fns/invitations.functions";
import { JurisAIWordmark } from "@/components/brand/JurisAILogo";

type Search = { token?: string };

export const Route = createFileRoute("/accept-invitation")({
  head: () => ({ meta: [{ title: "Rejoindre l'équipe · JurisAI" }] }),
  validateSearch: (search: Record<string, unknown>): Search => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: AcceptInvitationPage,
});

type Status = "loading" | "needs-auth" | "accepting" | "success" | "error";

function AcceptInvitationPage() {
  const { token } = Route.useSearch();
  const { session, user, loading: authLoading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const acceptFn = useServerFn(acceptInvitation);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  // 1. Validate token, fetch invitation preview
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Lien d'invitation invalide.");
      return;
    }
    void (async () => {
      const { data, error: fetchErr } = await supabase
        .from("invitations")
        .select("email, accepted_at, expires_at")
        .eq("token", token)
        .maybeSingle();

      // Anonymous users may be blocked by RLS; we'll just continue and let the
      // server function validate when they're logged in.
      if (data) {
        const inv = data as { email: string; accepted_at: string | null; expires_at: string };
        setInviteEmail(inv.email);
        if (inv.accepted_at) {
          setStatus("error");
          setError("Cette invitation a déjà été acceptée.");
          return;
        }
        if (new Date(inv.expires_at) < new Date()) {
          setStatus("error");
          setError("Cette invitation a expiré.");
          return;
        }
      }
      // (fetchErr is silent — likely RLS for anon, server fn will validate)
      void fetchErr;

      if (authLoading) return;
      if (!session) {
        setStatus("needs-auth");
        return;
      }
      // Logged in → try to accept
      setStatus("accepting");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, authLoading, session?.user.id]);

  // 2. Auto-accept once logged in
  useEffect(() => {
    if (status !== "accepting" || !token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      try {
        await acceptFn({ data: { token } });
        if (cancelled) return;
        await refreshProfile();
        if (cancelled) return;
        setStatus("success");
        toast.success("Bienvenue dans l'équipe !");
        timer = setTimeout(() => { if (!cancelled) void navigate({ to: "/dashboard" }); }, 1500);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        setError(msg);
      }
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, token]);

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center p-4">
      <div className="glass-panel w-full max-w-md rounded-3xl p-8 shadow-[var(--shadow-elevated)]">
        <div className="flex justify-center">
          <JurisAIWordmark />
        </div>

        <div className="mt-8 flex flex-col items-center text-center">
          {status === "loading" && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
              <p className="mt-4 text-[14px] text-muted-foreground">Vérification de l'invitation…</p>
            </>
          )}

          {status === "needs-auth" && (
            <>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
                <Mail className="h-7 w-7" />
              </div>
              <h1 className="mt-5 text-[20px] font-bold text-foreground">
                Vous êtes invité(e) !
              </h1>
              {inviteEmail && (
                <p className="mt-2 text-[13.5px] text-muted-foreground">
                  Connectez-vous ou créez un compte avec{" "}
                  <span className="font-semibold text-foreground">{inviteEmail}</span> pour rejoindre
                  l'équipe.
                </p>
              )}
              <div className="mt-6 flex w-full flex-col gap-2">
                <Link
                  to="/signup"
                  search={{ redirect: `/accept-invitation?token=${token ?? ""}` }}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-[14px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
                >
                  Créer un compte
                </Link>
                <Link
                  to="/login"
                  search={{ redirect: `/accept-invitation?token=${token ?? ""}` }}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-border text-[14px] font-medium text-foreground transition hover:bg-secondary"
                >
                  J'ai déjà un compte
                </Link>
              </div>
            </>
          )}

          {status === "accepting" && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
              <p className="mt-4 text-[14px] text-muted-foreground">
                Ajout à l'organisation en cours…
              </p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h1 className="mt-5 text-[20px] font-bold text-foreground">Bienvenue !</h1>
              <p className="mt-2 text-[13.5px] text-muted-foreground">
                Redirection vers votre tableau de bord…
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertCircle className="h-7 w-7" />
              </div>
              <h1 className="mt-5 text-[20px] font-bold text-foreground">
                Invitation invalide
              </h1>
              <p className="mt-2 text-[13.5px] text-muted-foreground">{error}</p>
              <Link
                to="/"
                className="mt-6 inline-flex h-11 items-center justify-center rounded-xl border border-border px-5 text-[13.5px] font-medium text-foreground transition hover:bg-secondary"
              >
                Retour à l'accueil
              </Link>
            </>
          )}
        </div>

        {user && status !== "success" && (
          <p className="mt-8 text-center text-[11.5px] text-muted-foreground">
            Connecté en tant que <span className="font-medium text-foreground">{user.email}</span>
          </p>
        )}
      </div>
    </div>
  );
}
