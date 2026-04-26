import { createFileRoute } from "@tanstack/react-router";
import {
  Sparkles,
  MessageSquare,
  Bell,
  FileText,
  FolderOpen,
  Users,
  ArrowRight,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord · JurisAI" }] }),
  component: DashboardPage,
});

const COMING_SOON = [
  {
    icon: MessageSquare,
    title: "Assistant IA",
    desc: "Posez vos questions juridiques en langage naturel.",
  },
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

function DashboardPage() {
  const { profile, user } = useAuth();
  const firstName = (profile?.full_name ?? user?.email ?? "").split(" ")[0] ?? "";

  return (
    <AppShell>
      <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-foreground">
              Bienvenue {firstName} 👋
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Votre espace JurisAI est prêt. Les fonctionnalités IA arrivent très bientôt.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                Bientôt disponible
                <ArrowRight className="h-3 w-3" />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-accent/20 bg-accent-soft p-5">
          <p className="text-[13.5px] font-semibold text-foreground">
            🚀 Prochaine étape : Phase 2 — Veille juridique automatique
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Ingestion quotidienne du Journal Officiel, URSSAF et Légifrance, classification IA par
            secteur et IDCC, alertes email personnalisées.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
