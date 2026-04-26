import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell, Field } from "@/routes/login";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Nouveau mot de passe · JurisAI" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Mot de passe trop court", { description: "Minimum 8 caractères." });
      return;
    }
    if (password !== confirm) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error("Erreur", { description: error.message });
      return;
    }
    toast.success("Mot de passe mis à jour");
    void navigate({ to: "/dashboard" });
  };

  return (
    <AuthShell title="Nouveau mot de passe" subtitle="Choisissez un mot de passe sécurisé.">
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Field
          label="Nouveau mot de passe"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          placeholder="8 caractères minimum"
        />
        <Field
          label="Confirmer"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent text-[14px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Mettre à jour
        </button>
      </form>

      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        <Link to="/login" className="font-medium text-accent hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </AuthShell>
  );
}
