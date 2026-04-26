import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell, Field } from "@/routes/login";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Mot de passe oublié · JurisAI" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setLoading(false);
    if (error) {
      toast.error("Erreur", { description: error.message });
      return;
    }
    setSent(true);
    toast.success("Email envoyé", { description: "Vérifiez votre boîte de réception." });
  };

  return (
    <AuthShell
      title="Mot de passe oublié"
      subtitle="Recevez un lien sécurisé pour le réinitialiser."
    >
      {sent ? (
        <div className="mt-8 rounded-2xl border border-accent/20 bg-accent-soft p-5 text-center">
          <p className="text-[14px] font-semibold text-foreground">Email envoyé ✓</p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Cliquez sur le lien dans l'email reçu pour définir un nouveau mot de passe.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <Field
            label="Email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={setEmail}
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent text-[14px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Envoyer le lien
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        <Link to="/login" className="font-medium text-accent hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </AuthShell>
  );
}
