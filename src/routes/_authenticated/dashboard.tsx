import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Sparkles,
  MessageSquare,
  Bell,
  FileText,
  FolderOpen,
  Users,
  ArrowRight,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord · JurisAI" }] }),
  component: DashboardPage,
});

const COMING_SOON = [
  {
    icon: Bell,
    title: "Veille juridique",
    desc: "Suivi quotidien du JO, URSSAF et Légifrance.",
  },
  {
    icon: FileText,
    title: "Génération documents",
    desc: "Contrats, courriers, attestations en un clic.",
  },
  {
    icon: FolderOpen,
    title: "Analyse de contrats",
    desc: "Importez un PDF, obtenez un résumé clé en main.",
  },
  {
    icon: Users,
    title: "Collaboration équipe",
    desc: "Invitez vos collègues et partagez l'historique.",
  },
] as const;

type Tenant = {
  name: string;
  plan: string;
  quota_questions: number;
  questions_used: number;
};

function DashboardPage() {
  const { profile, user } = useAuth();
  const firstName = (profile?.full_name ?? user?.email ?? "").split(" ")[0] ?? "";
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    if (!profile?.tenant_id) return;
    void (async () => {
      const { data } = await supabase
        .from("tenants")
        .select("name, plan, quota_questions, questions_used")
        .eq("id", profile.tenant_id!)
        .maybeSingle();
      setTenant((data as Tenant | null) ?? null);
    })();
  }, [profile?.tenant_id]);

  const quotaPct = tenant
    ? Math.min(100, Math.round((tenant.questions_used / tenant.quota_questions) * 100))
    : 0;

  return (
    <AppShell>
      <div className="space-y-3 overflow-y-auto">
        {/* Hero welcome */}
        <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h1 className="text-[26px] font-bold tracking-tight text-foreground">
                Bienvenue {firstName} 👋
              </h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Votre assistant juridique IA est prêt. Posez votre première question.
              </p>
            </div>
          </div>

          {/* Primary CTA + quota */}
          <div className="mt-6 grid gap-3 lg:grid-cols-3">
            <Link
              to="/chat"
              className="group lg:col-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-accent p-6 text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-[16px] font-semibold">Assistant IA juridique</h3>
                  <p className="mt-1 text-[13px] opacity-90">
                    Droit du travail, conventions collectives, URSSAF — réponses sourcées en quelques
                    secondes.
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
              </div>
            </Link>

            <div className="rounded-2xl border border-border bg-background p-5">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-accent" />
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Quota mensuel
                </h3>
              </div>
              {tenant ? (
                <>
                  <p className="mt-3 text-[24px] font-bold text-foreground">
                    {tenant.questions_used}
                    <span className="text-[14px] font-medium text-muted-foreground">
                      {" "}
                      / {tenant.quota_questions}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    questions · plan{" "}
                    <span className="font-semibold capitalize text-foreground">{tenant.plan}</span>
                  </p>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all"
                      style={{ width: `${quotaPct}%` }}
                    />
                  </div>
                </>
              ) : (
                <p className="mt-3 text-[12px] text-muted-foreground">Chargement…</p>
              )}
            </div>
          </div>
        </div>

        {/* Coming soon */}
        <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
          <h2 className="text-[18px] font-bold tracking-tight text-foreground">
            Bientôt disponible
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Les prochaines fonctionnalités de votre espace JurisAI.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {COMING_SOON.map((c) => (
              <div
                key={c.title}
                className="group relative overflow-hidden rounded-2xl border border-border bg-background p-5 transition hover:shadow-[var(--shadow-card)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <c.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-[15px] font-semibold text-foreground">{c.title}</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{c.desc}</p>
                <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
                  Bientôt
                  <ArrowRight className="h-3 w-3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
