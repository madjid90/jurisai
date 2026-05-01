import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles, Zap, Shield, Users } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";

export const Route = createFileRoute("/_authenticated/upgrade")({
  head: () => ({
    meta: [
      { title: "Passer au plan Pro — JurisAI" },
      { name: "description", content: "Découvrez les plans JurisAI Pro et Enterprise : IA illimitée, veille personnalisée, équipe étendue." },
    ],
  }),
  component: UpgradePage,
});

type Plan = {
  name: string;
  price: string;
  period: string;
  highlight?: boolean;
  description: string;
  features: string[];
  cta: string;
};

const PLANS: Plan[] = [
  {
    name: "Starter",
    price: "0€",
    period: "/mois",
    description: "Pour découvrir JurisAI",
    features: [
      "20 questions IA / mois",
      "5 documents générés",
      "1 utilisateur",
      "Sources juridiques officielles",
    ],
    cta: "Plan actuel",
  },
  {
    name: "Pro",
    price: "49€",
    period: "/mois / utilisateur",
    highlight: true,
    description: "Pour les professionnels du droit",
    features: [
      "IA illimitée (questions + génération)",
      "Veille juridique personnalisée",
      "Dossiers et procédures illimités",
      "Workflows de validation",
      "Jusqu'à 10 utilisateurs",
      "Support prioritaire",
    ],
    cta: "Nous contacter",
  },
  {
    name: "Enterprise",
    price: "Sur devis",
    period: "",
    description: "Pour les cabinets et entreprises",
    features: [
      "Tout le plan Pro",
      "Utilisateurs illimités",
      "SSO / SAML",
      "API dédiée",
      "Hébergement souverain",
      "Account manager dédié",
    ],
    cta: "Demander un devis",
  },
];

const VALUE_PROPS = [
  { icon: Sparkles, title: "IA juridique sourcée", desc: "Toutes les réponses sont citées depuis les sources officielles (Légifrance, KaliData, JuriCA…)." },
  { icon: Shield, title: "Validation hiérarchique", desc: "Les actions sensibles passent par un circuit de validation paramétrable." },
  { icon: Zap, title: "Workflows automatisés", desc: "Procédures préconfigurées (licenciement, RGPD, contentieux…)." },
  { icon: Users, title: "Multi-utilisateurs", desc: "Travaillez en équipe avec rôles, permissions et pistes d'audit." },
];

function UpgradePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-10 py-6">
        <header className="text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-1.5 text-[12px] font-semibold text-accent-soft-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Passez à la vitesse supérieure
          </div>
          <h1 className="mt-4 text-3xl font-bold text-foreground md:text-4xl">
            Choisissez le plan adapté à votre cabinet
          </h1>
          <p className="mt-3 text-[14px] text-muted-foreground">
            Sans engagement. Migration de plan à tout moment.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <article
              key={plan.name}
              className={
                plan.highlight
                  ? "relative rounded-3xl border-2 border-primary bg-card p-6 shadow-[var(--shadow-glow)]"
                  : "rounded-3xl border border-border bg-card p-6"
              }
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                  Recommandé
                </div>
              )}
              <h2 className="text-lg font-semibold text-foreground">{plan.name}</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">{plan.description}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                <span className="text-[12px] text-muted-foreground">{plan.period}</span>
              </div>
              <ul className="mt-5 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] text-foreground/80">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href={
                  plan.name === "Starter"
                    ? "#"
                    : `mailto:contact@jurisai.fr?subject=Demande%20plan%20${encodeURIComponent(plan.name)}`
                }
                className={
                  plan.highlight
                    ? "mt-6 block w-full rounded-xl bg-gradient-to-r from-primary to-accent py-2.5 text-center text-[13px] font-semibold text-primary-foreground transition hover:opacity-90"
                    : "mt-6 block w-full rounded-xl border border-border bg-secondary py-2.5 text-center text-[13px] font-medium text-foreground transition hover:bg-secondary/70"
                }
              >
                {plan.cta}
              </a>
            </article>
          ))}
        </section>

        <section className="grid gap-4 rounded-3xl border border-border bg-card p-6 md:grid-cols-2 lg:grid-cols-4">
          {VALUE_PROPS.map((v) => (
            <div key={v.title} className="space-y-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <v.icon className="h-4 w-4" />
              </div>
              <h3 className="text-[13.5px] font-semibold text-foreground">{v.title}</h3>
              <p className="text-[12px] leading-relaxed text-muted-foreground">{v.desc}</p>
            </div>
          ))}
        </section>

        <footer className="text-center text-[12px] text-muted-foreground">
          Une question ?{" "}
          <a href="mailto:contact@jurisai.fr" className="font-medium text-accent hover:underline">
            contact@jurisai.fr
          </a>{" "}
          •{" "}
          <Link to="/dashboard" className="font-medium text-accent hover:underline">
            Retour au tableau de bord
          </Link>
        </footer>
      </div>
    </AppShell>
  );
}
