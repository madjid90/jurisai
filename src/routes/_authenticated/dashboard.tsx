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
  Workflow,
  ScanLine,
  ShieldCheck,
  Briefcase,
  Calculator,
  Scale,
  Building2,
  UserCog,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord · JurisAI" }] }),
  component: DashboardPage,
});

type ProfileKind =
  | "dirigeant"
  | "rh"
  | "juriste"
  | "expert_comptable"
  | "manager_multi_sites";

type QuickAction = {
  to: string;
  icon: typeof MessageSquare;
  title: string;
  desc: string;
};

const PROFILE_CONFIG: Record<
  ProfileKind,
  {
    label: string;
    icon: typeof Briefcase;
    tagline: string;
    actions: QuickAction[];
  }
> = {
  dirigeant: {
    label: "Dirigeant",
    icon: Briefcase,
    tagline: "Vos décisions clés et vos obligations légales en un coup d'œil.",
    actions: [
      { to: "/chat", icon: MessageSquare, title: "Poser une question RH/juridique", desc: "Décisions d'embauche, ruptures, conformité." },
      { to: "/workflows", icon: Workflow, title: "Procédures guidées", desc: "Absence injustifiée, entretien, sanction." },
      { to: "/templates", icon: FileText, title: "Modèles juridiques", desc: "Contrats, courriers, attestations." },
      { to: "/veille", icon: Bell, title: "Veille réglementaire", desc: "Évolutions du droit qui vous concernent." },
    ],
  },
  rh: {
    label: "RH",
    icon: UserCog,
    tagline: "Votre boîte à outils RH au quotidien.",
    actions: [
      { to: "/workflows", icon: Workflow, title: "Procédures RH", desc: "Conduite d'entretien, gestion d'absence, sanction." },
      { to: "/templates", icon: FileText, title: "Modèles RH", desc: "Convocations, avenants, attestations." },
      { to: "/chat", icon: MessageSquare, title: "Assistant juridique IA", desc: "Convention collective, congés, temps de travail." },
      { to: "/dossiers", icon: FolderOpen, title: "Dossiers salariés", desc: "Centralisez documents et historique." },
    ],
  },
  juriste: {
    label: "Juriste",
    icon: Scale,
    tagline: "Recherche sourcée, analyse fine, traçabilité complète.",
    actions: [
      { to: "/chat", icon: MessageSquare, title: "Recherche juridique RAG", desc: "Réponses sourcées Légifrance + JO + conventions." },
      { to: "/agent", icon: Sparkles, title: "Agent légal multi-outils", desc: "Recherche, comparaison, synthèse." },
      { to: "/analyses", icon: ScanLine, title: "Analyses de documents", desc: "Contrats, accords, jurisprudence." },
      { to: "/veille", icon: Bell, title: "Veille juridique", desc: "Suivi quotidien JO/URSSAF/Légifrance." },
    ],
  },
  expert_comptable: {
    label: "Expert-comptable",
    icon: Calculator,
    tagline: "Multi-clients, multi-conventions — tout au même endroit.",
    actions: [
      { to: "/dossiers", icon: FolderOpen, title: "Dossiers clients", desc: "Vue par société, convention, échéances." },
      { to: "/chat", icon: MessageSquare, title: "Assistant social/fiscal", desc: "URSSAF, paie, déclarations." },
      { to: "/templates", icon: FileText, title: "Modèles & courriers", desc: "Pour vos clients en quelques clics." },
      { to: "/veille", icon: Bell, title: "Veille réglementaire", desc: "Changements à répercuter aux clients." },
    ],
  },
  manager_multi_sites: {
    label: "Manager multi-sites",
    icon: Building2,
    tagline: "Pilotez plusieurs équipes, plusieurs conventions, sans rien oublier.",
    actions: [
      { to: "/dossiers", icon: FolderOpen, title: "Dossiers par site", desc: "Une vue consolidée par établissement." },
      { to: "/workflows", icon: Workflow, title: "Procédures standardisées", desc: "Mêmes process partout, sans erreur." },
      { to: "/chat", icon: MessageSquare, title: "Question juridique express", desc: "Réponse adaptée à la convention du site." },
      { to: "/team", icon: Users, title: "Équipe & permissions", desc: "Déléguez aux managers locaux." },
    ],
  },
};

const DEFAULT_ACTIONS: QuickAction[] = [
  { to: "/chat", icon: MessageSquare, title: "Assistant IA juridique", desc: "Posez votre première question." },
  { to: "/workflows", icon: Workflow, title: "Procédures guidées", desc: "Absence, entretien, sanction." },
  { to: "/templates", icon: FileText, title: "Modèles RH", desc: "Bibliothèque prête à l'emploi." },
  { to: "/veille", icon: Bell, title: "Veille juridique", desc: "Restez informé des évolutions." },
];

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

  const profileKind = (profile as { profile_kind?: ProfileKind } | null)?.profile_kind;
  const config = profileKind ? PROFILE_CONFIG[profileKind] : null;
  const ProfileIcon = config?.icon ?? Sparkles;
  const actions = config?.actions ?? DEFAULT_ACTIONS;

  return (
    <AppShell>
      <div className="space-y-3 overflow-y-auto">
        {/* Hero welcome — adapté au profil */}
        <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)]">
              <ProfileIcon className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[26px] font-bold tracking-tight text-foreground">
                  Bonjour {firstName} 👋
                </h1>
                {config && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-accent-soft-foreground">
                    Espace {config.label}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[14px] text-muted-foreground">
                {config?.tagline ??
                  "Votre assistant juridique IA est prêt. Posez votre première question."}
              </p>
            </div>
          </div>

          {/* Primary CTA + quota */}
          <div className="mt-6 grid gap-3 lg:grid-cols-3">
            <Link
              to={actions[0].to}
              className="group lg:col-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-accent p-6 text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                  {(() => {
                    const Icon = actions[0].icon;
                    return <Icon className="h-5 w-5" />;
                  })()}
                </div>
                <div className="flex-1">
                  <h3 className="text-[16px] font-semibold">{actions[0].title}</h3>
                  <p className="mt-1 text-[13px] opacity-90">{actions[0].desc}</p>
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

        {/* Raccourcis adaptés au profil */}
        <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[18px] font-bold tracking-tight text-foreground">
                Vos raccourcis
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {config
                  ? `Sélection adaptée à votre profil ${config.label.toLowerCase()}.`
                  : "Définissez votre profil dans les réglages pour personnaliser cette page."}
              </p>
            </div>
            {!profileKind && (
              <Link
                to="/settings"
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-[12.5px] font-semibold text-foreground hover:bg-secondary"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Définir mon profil
              </Link>
            )}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {actions.map((a) => (
              <Link
                key={a.to + a.title}
                to={a.to}
                className="group relative overflow-hidden rounded-2xl border border-border bg-background p-5 transition hover:shadow-[var(--shadow-card)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <a.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-[15px] font-semibold text-foreground">{a.title}</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{a.desc}</p>
                <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
                  Ouvrir
                  <ArrowRight className="h-3 w-3 transition group-hover:translate-x-1" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
