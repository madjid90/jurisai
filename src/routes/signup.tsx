import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell, Field } from "@/routes/login";

type SignupSearch = { redirect?: string };

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [{ title: "Créer un compte · JurisAI" }],
  }),
  validateSearch: (search: Record<string, unknown>): SignupSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Mot de passe trop court", { description: "Minimum 8 caractères." });
      return;
    }
    setLoading(true);
    const returnPath = redirect ?? "/onboarding";
    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}${returnPath}` : undefined;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: redirectTo,
      },
    });
    setLoading(false);
    if (error) {
      toast.error("Inscription impossible", { description: error.message });
      return;
    }
    toast.success("Compte créé !", {
      description: "Vérifiez votre email pour confirmer votre adresse.",
    });
    void navigate({ to: "/login", search: redirect ? { redirect } : undefined });
  };

  return (
    <AuthShell
      title="Créer votre compte"
      subtitle="14 jours d'essai gratuit. Sans carte bancaire."
    >
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Field
          label="Nom complet"
          required
          autoComplete="name"
          value={fullName}
          onChange={setFullName}
          placeholder="Sophie Martin"
        />
        <Field
          label="Email professionnel"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={setEmail}
          placeholder="sophie@entreprise.fr"
        />
        <Field
          label="Mot de passe"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          placeholder="8 caractères minimum"
        />

        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent text-[14px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Créer mon compte
        </button>

        <p className="text-center text-[11.5px] text-muted-foreground">
          En créant un compte, vous acceptez nos CGU et notre politique de confidentialité.
        </p>
      </form>

      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        Déjà un compte ?{" "}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Se connecter
        </Link>
      </p>
    </AuthShell>
  );
}
