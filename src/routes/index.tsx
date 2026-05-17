import { createFileRoute } from "@tanstack/react-router";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";
import {
  HeroSection,
  FeaturesSection,
  UseCasesSection,
  PricingSection,
  CtaSection,
} from "@/components/public/landing-sections";
import { DemoSection } from "@/components/landing/DemoSection";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JurisAI — Assistant juridique IA pour PME, RH et indépendants" },
      {
        name: "description",
        content:
          "Votre juriste IA disponible 24/7. Réponses fiables, sourcées, adaptées à votre convention collective. Pour PME, RH, dirigeants et indépendants. 14 jours d'essai gratuit.",
      },
      { property: "og:title", content: "JurisAI — Assistant juridique IA pour les pros" },
      {
        property: "og:description",
        content:
          "Votre juriste IA disponible 24/7. Réponses fiables, sourcées, adaptées à votre convention collective.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main>
        <HeroSection />
        <DemoSection />
        <FeaturesSection />
        <UseCasesSection />
        <PricingSection />
        <CtaSection />
      </main>
      <PublicFooter />
    </div>
  );
}
