import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { JurisAIWordmark } from "@/components/brand/JurisAILogo";

type LoginSearch = { redirect?: string };

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Connexion · JurisAI" }],
  }),
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error("Connexion impossible", { description: error.message });
      return;
    }
    toast.success("Bienvenue !");
    void navigate({ to: redirect ?? "/dashboard" });
  };

  return (
    <AuthShell title="Connexion" subtitle="Heureux de vous revoir.">
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Field
          label="Email professionnel"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(v) => setEmail(v)}
        />
        <Field
          label="Mot de passe"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(v) => setPassword(v)}
          rightSlot={
            <Link
              to="/forgot-password"
              className="text-[12px] font-medium text-accent hover:underline"
            >
              Oublié ?
            </Link>
          }
        />

        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent text-[14px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Se connecter
        </button>
      </form>

      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        Pas encore de compte ?{" "}
        <Link to="/signup" className="font-medium text-accent hover:underline">
          Créer un compte
        </Link>
      </p>
    </AuthShell>
  );
}

// ─── Shared components ─────────────────────────────────────────────────────

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mesh-bg relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Link to="/">
            <JurisAIWordmark />
          </Link>
        </div>
        <div className="glass-panel rounded-3xl p-8 shadow-[var(--shadow-elevated)]">
          <h1 className="text-[24px] font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-1 text-[13.5px] text-muted-foreground">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  type = "text",
  value,
  onChange,
  required,
  autoComplete,
  rightSlot,
  placeholder,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  rightSlot?: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-foreground/80">{label}</span>
        {rightSlot}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-input bg-background px-4 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
    </label>
  );
}
