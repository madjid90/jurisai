import { Link } from "@tanstack/react-router";
import {
  Sparkles,
  ShieldCheck,
  FileSearch,
  MessageSquare,
  Bell,
  FileText,
  Building2,
  Users,
  Briefcase,
  Calculator,
  Check,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="mesh-bg absolute inset-0 -z-10" />
      <div className="mx-auto max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[12px] font-medium text-foreground/80 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Propulsé par GPT-4o · Sources Légifrance & JO
          </div>

          <h1 className="mt-6 text-balance text-[44px] font-bold leading-[1.05] tracking-tight text-foreground sm:text-[56px]">
            Votre assistant juridique IA,
            <br />
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              fiable et sourcé.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-[16.5px] leading-relaxed text-muted-foreground">
            Pour les <strong className="text-foreground">PME, RH, dirigeants et indépendants</strong> qui
            n'ont pas de juriste interne. Posez vos questions en langage clair, obtenez des réponses
            adaptées à votre convention collective — avec les sources officielles à l'appui.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-6 text-[14px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
            >
              Commencer gratuitement
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#features"
              className="inline-flex h-12 items-center rounded-xl border border-border bg-card/70 px-6 text-[14px] font-semibold text-foreground backdrop-blur transition hover:bg-card"
            >
              Voir les fonctionnalités
            </a>
          </div>

          <p className="mt-5 text-[12.5px] text-muted-foreground">
            14 jours d'essai · Sans CB · Conforme RGPD · Données hébergées en UE
          </p>
        </div>

        {/* Decorative card preview */}
        <div className="relative mx-auto mt-16 max-w-4xl">
          <div className="glass-panel overflow-hidden rounded-3xl p-6 shadow-[var(--shadow-elevated)]">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="rounded-2xl bg-secondary/60 p-4 text-[14px] text-foreground/80">
                  « Un de mes salariés en CDI veut prendre 3 jours pour le mariage de son frère.
                  J'ai droit de refuser ? »
                </div>
                <div className="mt-3 rounded-2xl border border-accent/20 bg-accent-soft p-4">
                  <p className="text-[13.5px] font-semibold text-foreground">
                    Réponse adaptée à votre convention (Syntec, IDCC 1486)
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-foreground/80">
                    Le mariage du frère ouvre droit à <strong>1 jour de congé exceptionnel</strong>
                    {" "}selon l'art. L3142-1 du Code du travail (minimum légal). Votre convention
                    Syntec accorde <strong>1 jour supplémentaire</strong> pour les frères et sœurs.
                    Vous ne pouvez refuser ces 2 jours.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <SourceTag>Code du travail · L3142-1</SourceTag>
                    <SourceTag>Syntec IDCC 1486 · art. 25</SourceTag>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-1 text-[11px] font-medium text-foreground/70 ring-1 ring-border">
      <FileText className="h-3 w-3" />
      {children}
    </span>
  );
}

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Assistant IA juridique",
    desc: "Posez vos questions en langage naturel. Réponses sourcées, adaptées à votre IDCC et secteur.",
  },
  {
    icon: Bell,
    title: "Veille personnalisée",
    desc: "Recevez chaque jour les nouveautés du JO, URSSAF, Légifrance pertinentes pour votre activité.",
  },
  {
    icon: FileText,
    title: "Génération de documents",
    desc: "Contrats, courriers, notes, attestations — créés et personnalisés en quelques clics.",
  },
  {
    icon: FileSearch,
    title: "Analyse de contrats",
    desc: "Importez un PDF, obtenez résumé, clauses sensibles et recommandations en 30 secondes.",
  },
  {
    icon: Users,
    title: "Collaboration équipe",
    desc: "Invitez vos collègues, partagez documents et historique. Rôles fins par utilisateur.",
  },
  {
    icon: ShieldCheck,
    title: "RGPD & confidentialité",
    desc: "Hébergement UE, chiffrement bout-en-bout. Vos données ne servent jamais à entraîner l'IA.",
  },
] as const;

export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-border/40 bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[34px] font-bold tracking-tight text-foreground sm:text-[42px]">
            Tout ce dont un pro a besoin,
            <br />
            <span className="text-accent">sans payer un juriste.</span>
          </h2>
          <p className="mt-4 text-[15.5px] text-muted-foreground">
            Une suite complète pour gérer le juridique au quotidien sans formation.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] transition hover:shadow-[var(--shadow-elevated)]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <f.icon className="h-[22px] w-[22px]" />
              </div>
              <h3 className="mt-4 text-[16px] font-semibold text-foreground">{f.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const USE_CASES = [
  {
    icon: Building2,
    title: "Dirigeants de PME / TPE",
    desc: "Décisions juridiques quotidiennes : contrats, baux, conformité, social. Sans cabinet d'avocat à chaque question.",
  },
  {
    icon: Users,
    title: "Responsables RH",
    desc: "Gestion des contrats, conventions collectives, ruptures, congés. Réponses calées sur votre IDCC.",
  },
  {
    icon: Calculator,
    title: "Experts-comptables",
    desc: "Côté social et juridique pour vos clients. Veille réglementaire automatique sur tous leurs secteurs.",
  },
  {
    icon: Briefcase,
    title: "Indépendants & freelances",
    desc: "Statut, factures, CGV, propriété intellectuelle. Tout ce qu'on devrait savoir sans être juriste.",
  },
] as const;

export function UseCasesSection() {
  return (
    <section id="use-cases" className="bg-secondary/30 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[34px] font-bold tracking-tight text-foreground sm:text-[42px]">
            Conçu pour les pros,
            <br />
            <span className="text-accent">pas pour les avocats.</span>
          </h2>
          <p className="mt-4 text-[15.5px] text-muted-foreground">
            JurisAI parle votre langue, pas le jargon juridique.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {USE_CASES.map((u) => (
            <div
              key={u.title}
              className="group flex gap-5 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] transition hover:shadow-[var(--shadow-elevated)]"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
                <u.icon className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-[16px] font-semibold text-foreground">{u.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                  {u.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type Plan = {
  name: string;
  price: string;
  period: string;
  desc: string;
  features: string[];
  cta: string;
  highlight?: boolean;
};

const PLANS: Plan[] = [
  {
    name: "Starter",
    price: "29€",
    period: "/mois HT",
    desc: "Pour démarrer en solo.",
    features: [
      "1 utilisateur",
      "100 questions IA / mois",
      "Veille juridique quotidienne",
      "Modèles de contrats de base",
      "Support email",
    ],
    cta: "Commencer",
  },
  {
    name: "Pro",
    price: "99€",
    period: "/mois HT",
    desc: "Pour les TPE et freelances exigeants.",
    features: [
      "Jusqu'à 5 utilisateurs",
      "1 000 questions IA / mois",
      "Veille personnalisée par IDCC",
      "Génération de documents avancée",
      "Analyse de contrats (PDF)",
      "Support prioritaire",
    ],
    cta: "Essayer 14 jours",
    highlight: true,
  },
  {
    name: "Business",
    price: "299€",
    period: "/mois HT",
    desc: "Pour les PME et cabinets d'expertise.",
    features: [
      "Utilisateurs illimités",
      "Questions IA illimitées",
      "Multi-IDCC et multi-secteurs",
      "Bibliothèque docs partagée",
      "Gestion clients & dossiers",
      "Support dédié + formation",
    ],
    cta: "Démarrer",
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="border-t border-border/40 bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[34px] font-bold tracking-tight text-foreground sm:text-[42px]">
            Tarifs simples, sans surprise.
          </h2>
          <p className="mt-4 text-[15.5px] text-muted-foreground">
            14 jours d'essai gratuit sur tous les plans. Sans engagement, résiliable à tout moment.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "relative flex flex-col rounded-3xl border p-7 shadow-[var(--shadow-card)] transition",
                plan.highlight
                  ? "border-accent/30 bg-card ring-2 ring-accent/40"
                  : "border-border bg-card hover:shadow-[var(--shadow-elevated)]",
              )}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-primary to-accent px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)]">
                  Le plus populaire
                </div>
              )}
              <h3 className="text-[18px] font-semibold text-foreground">{plan.name}</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">{plan.desc}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-[36px] font-bold text-foreground">{plan.price}</span>
                <span className="text-[13px] text-muted-foreground">{plan.period}</span>
              </div>

              <ul className="mt-6 flex-1 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-foreground/80">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/signup"
                className={cn(
                  "mt-7 inline-flex h-11 items-center justify-center rounded-xl text-[13.5px] font-semibold transition",
                  plan.highlight
                    ? "bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[var(--shadow-glow)] hover:opacity-95"
                    : "border border-border bg-background text-foreground hover:bg-secondary",
                )}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaSection() {
  return (
    <section className="bg-secondary/30 py-20">
      <div className="mx-auto max-w-4xl px-6">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-accent p-10 text-center shadow-[var(--shadow-elevated)] sm:p-14">
          <h2 className="text-[30px] font-bold tracking-tight text-primary-foreground sm:text-[36px]">
            Prêt à arrêter de payer un juriste à l'heure ?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] text-primary-foreground/80">
            Démarrez en 2 minutes. 14 jours gratuits, sans carte bancaire.
          </p>
          <Link
            to="/signup"
            className="mt-7 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-[14px] font-semibold text-primary transition hover:bg-white/90"
          >
            Créer mon compte gratuit
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
