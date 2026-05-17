// Section démo interactive sur la landing — "Voir l'agent en action".
// Contenu statique (hardcodé) — pas d'appel API. Simule le raisonnement de l'agent
// avec effet typewriter, sources citées et CTA vers signup.

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Calculator, Mail, ShieldCheck, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

type DemoCase = {
  id: string;
  label: string;
  icon: typeof Calculator;
  question: string;
  steps: string[];
  sources: { n: number; label: string }[];
  result: { title: string; body: string };
};

const CASES: DemoCase[] = [
  {
    id: "indemnite",
    label: "Indemnité de licenciement",
    icon: Calculator,
    question:
      "Calcule l'indemnité de licenciement pour un cadre Syntec, 8 ans d'ancienneté, salaire mensuel brut 4 200 €, motif cause réelle et sérieuse.",
    steps: [
      "🔎 Recherche dans les sources juridiques (Code du travail + Syntec IDCC 1486)…",
      "📊 Calcul de l'indemnité légale (art. R.1234-2 C. trav.)…",
      "📑 Calcul de l'indemnité conventionnelle Syntec (art. 19 CCN)…",
      "⚖️ Application du principe de faveur (le plus avantageux pour le salarié)…",
    ],
    sources: [
      { n: 1, label: "Code du travail — art. L.1234-9 et R.1234-2 (indemnité légale)" },
      { n: 2, label: "CCN Syntec IDCC 1486 — art. 19 (indemnité conventionnelle)" },
      { n: 3, label: "Cass. soc. 14-9-2017 n°16-12.057 (base de calcul du salaire de référence)" },
    ],
    result: {
      title: "Indemnité due : 11 760 € (conventionnelle Syntec)",
      body:
        "Indemnité légale : 4 200 × 1/4 × 8 = 8 400 €. Indemnité conventionnelle Syntec : 4 200 × 0,35 × 8 = 11 760 €. Le principe de faveur impose la plus élevée : **11 760 €**. À cela s'ajoutent l'indemnité de préavis (3 mois cadre) et les congés payés non pris.",
    },
  },
  {
    id: "mise-en-demeure",
    label: "Mise en demeure fournisseur",
    icon: Mail,
    question:
      "Mon fournisseur a 45 jours de retard sur une facture de 8 500 €. Rédige une mise en demeure.",
    steps: [
      "🔎 Vérification des règles de mise en demeure (art. 1344 C. civ.)…",
      "📅 Calcul des intérêts de retard légaux (taux BCE +10 points pour B2B)…",
      "💼 Application du forfait de 40 € pour frais de recouvrement (L.441-10 C. com.)…",
      "✍️ Génération du courrier recommandé prêt à envoyer…",
    ],
    sources: [
      { n: 1, label: "Code civil — art. 1344 (mise en demeure)" },
      { n: 2, label: "Code de commerce — art. L.441-10 (délais de paiement + indemnité forfaitaire)" },
      { n: 3, label: "Arrêté du 26-12-2023 (taux d'intérêt légal S1 2024)" },
    ],
    result: {
      title: "Mise en demeure générée + bordereau LRAR",
      body:
        "Courrier produit avec : rappel des factures impayées, intérêts moratoires calculés (45j × taux BCE+10), indemnité forfaitaire 40 €, délai 8 jours, mention des suites (injonction de payer, référé-provision). **Total réclamé : 8 638,75 €**. Document prêt à imprimer et envoyer en recommandé.",
    },
  },
  {
    id: "rgpd",
    label: "Conformité RGPD cookies",
    icon: ShieldCheck,
    question:
      "Audit la conformité de mon site e-commerce sur la collecte de cookies. J'utilise Google Analytics, Meta Pixel et un chatbot.",
    steps: [
      "🔎 Vérification des bases légales (consentement art. 6 RGPD + délibération CNIL 2020-091)…",
      "🍪 Analyse des cookies déposés (analytics, marketing, fonctionnels)…",
      "⚠️ Détection des non-conformités courantes (dépôt avant consentement, refus pas aussi simple qu'accepter)…",
      "📋 Génération d'une checklist d'actions correctives…",
    ],
    sources: [
      { n: 1, label: "RGPD — art. 6 et 7 (consentement)" },
      { n: 2, label: "Délibération CNIL n°2020-091 du 17-9-2020 (lignes directrices cookies)" },
      { n: 3, label: "Sanction CNIL Google 60M€ — 31-12-2021 (refus complexe = non conforme)" },
    ],
    result: {
      title: "Score conformité : 4/10 — 3 actions urgentes",
      body:
        "**Non-conformités détectées** : (1) Google Analytics se déclenche avant consentement, (2) bouton « Refuser » absent du 1er niveau de la bannière, (3) durée de conservation des cookies analytics > 13 mois CNIL. **Actions** : bloquer GTM tant que consentement non donné, ajouter « Refuser tout » au même niveau que « Accepter », limiter `_ga` à 13 mois. Risque sanction : jusqu'à 4 % du CA.",
    },
  },
];

const TYPING_INTERVAL_MS = 280;

export function DemoSection() {
  const [activeId, setActiveId] = useState<string>(CASES[0].id);
  const activeCase = useMemo(() => CASES.find((c) => c.id === activeId)!, [activeId]);
  const [revealedSteps, setRevealedSteps] = useState(0);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    // Reset à chaque changement de cas, puis dévoile progressivement
    setRevealedSteps(0);
    setShowResult(false);
    let cancelled = false;
    const total = activeCase.steps.length;

    const reveal = (i: number) => {
      if (cancelled) return;
      if (i > total) {
        setShowResult(true);
        return;
      }
      setRevealedSteps(i);
      setTimeout(() => reveal(i + 1), TYPING_INTERVAL_MS);
    };
    const t = setTimeout(() => reveal(1), 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeCase]);

  return (
    <section id="demo" className="relative overflow-hidden border-t border-border bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[12px] font-medium text-foreground/80">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Démo interactive
          </div>
          <h2 className="mt-5 text-balance text-[32px] font-bold leading-tight tracking-tight text-foreground sm:text-[42px]">
            Voir l'agent <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">en action</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Trois cas réels traités par JurisAI en moins d'une minute. Pas de blabla — du raisonnement
            sourcé et un livrable concret.
          </p>
        </div>

        {/* Onglets cas d'usage */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {CASES.map((c) => {
            const Icon = c.icon;
            const isActive = c.id === activeId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition",
                  isActive
                    ? "border-primary/40 bg-gradient-to-br from-primary/15 to-accent/10 text-foreground shadow-[var(--shadow-card)]"
                    : "border-border bg-card/60 text-foreground/70 hover:bg-card hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Conversation simulée */}
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {/* Bulle question */}
          <div className="glass-panel rounded-3xl p-6 shadow-[var(--shadow-card)]">
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Vous demandez
            </p>
            <div className="mt-3 rounded-2xl bg-secondary/60 p-4 text-[14px] leading-relaxed text-foreground/90">
              {activeCase.question}
            </div>

            <p className="mt-6 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Raisonnement de l'agent
            </p>
            <ul className="mt-3 space-y-2">
              {activeCase.steps.map((step, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex items-start gap-2 rounded-xl border border-border/60 bg-card/40 p-3 text-[13px] text-foreground/80 transition-all duration-300",
                    i < revealedSteps ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
                  )}
                >
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Réponse agent */}
          <div
            className={cn(
              "rounded-3xl border border-accent/20 bg-accent-soft p-6 shadow-[var(--shadow-card)] transition-all duration-500",
              showResult ? "opacity-100" : "opacity-40",
            )}
          >
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
                <FileText className="h-4 w-4" />
              </div>
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Réponse JurisAI
              </p>
            </div>

            <h3 className="mt-4 text-[16px] font-semibold text-foreground">{activeCase.result.title}</h3>
            <p className="mt-3 text-[13.5px] leading-relaxed text-foreground/85">
              {activeCase.result.body}
            </p>

            <div className="mt-5 rounded-2xl border border-border/60 bg-card/70 p-4">
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sources citées
              </p>
              <ul className="mt-2 space-y-1.5">
                {activeCase.sources.map((s) => (
                  <li key={s.n} className="text-[12.5px] leading-relaxed text-foreground/75">
                    <span className="font-mono font-semibold text-accent">[source:{s.n}]</span>{" "}
                    {s.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                Exemple illustratif — résultats réels selon votre situation.
              </p>
              <Link
                to="/signup"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-4 text-[13px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95"
              >
                Essayer avec mon cas
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
