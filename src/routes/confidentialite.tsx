import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPageShell, LegalSection } from "@/components/public/LegalPageShell";

export const Route = createFileRoute("/confidentialite")({
  head: () => ({
    meta: [
      { title: "Politique de confidentialité · JurisAI" },
      {
        name: "description",
        content:
          "Politique de confidentialité et traitement des données personnelles JurisAI (RGPD).",
      },
    ],
  }),
  component: ConfidentialitePage,
});

function ConfidentialitePage() {
  return (
    <LegalPageShell
      title="Politique de confidentialité"
      updatedAt="26 avril 2026"
    >
      <LegalSection title="1. Responsable du traitement">
        <p>
          Le responsable du traitement est <strong>JurisAI SAS</strong>. Pour
          toute question relative à vos données personnelles, contactez :{" "}
          <a href="mailto:dpo@jurisai.fr" className="text-accent hover:underline">
            dpo@jurisai.fr
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="2. Données collectées">
        <p>Nous collectons les catégories de données suivantes :</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Données d'identification</strong> : nom, prénom, email,
            fonction, téléphone (facultatif).
          </li>
          <li>
            <strong>Données d'organisation</strong> : nom, SIRET, secteur,
            convention collective (IDCC).
          </li>
          <li>
            <strong>Données d'utilisation</strong> : conversations IA, documents
            générés, historique d'usage, logs techniques.
          </li>
          <li>
            <strong>Données de facturation</strong> : informations bancaires
            traitées par notre prestataire de paiement (non stockées par
            JurisAI).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Finalités et bases légales">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Exécution du contrat</strong> : fourniture du service,
            authentification, facturation.
          </li>
          <li>
            <strong>Intérêt légitime</strong> : amélioration du service,
            sécurité, prévention de la fraude.
          </li>
          <li>
            <strong>Obligation légale</strong> : conservation comptable,
            réponse aux réquisitions judiciaires.
          </li>
          <li>
            <strong>Consentement</strong> : envoi de communications marketing
            (révocable à tout moment).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Durée de conservation">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>Compte utilisateur : durée de l'abonnement + 3 ans.</li>
          <li>Conversations et documents : durée de l'abonnement + 1 an.</li>
          <li>Données de facturation : 10 ans (obligation légale).</li>
          <li>Logs techniques : 12 mois maximum.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Destinataires et sous-traitants">
        <p>
          Vos données sont traitées par les sous-traitants suivants, tous
          conformes au RGPD :
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Supabase</strong> (hébergement base de données) — Singapour /
            Union européenne.
          </li>
          <li>
            <strong>Cloudflare</strong> (hébergement application, CDN) — États-Unis
            (clauses contractuelles types).
          </li>
          <li>
            <strong>Lovable AI Gateway</strong> (modèles d'IA) — Union européenne.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Vos droits (RGPD)">
        <p>Conformément au RGPD, vous disposez des droits suivants :</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>droit d'accès, de rectification et d'effacement ;</li>
          <li>droit à la limitation et à l'opposition au traitement ;</li>
          <li>droit à la portabilité de vos données ;</li>
          <li>
            droit d'introduire une réclamation auprès de la{" "}
            <a
              href="https://www.cnil.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              CNIL
            </a>
            .
          </li>
        </ul>
        <p>
          Vous pouvez exercer ces droits depuis vos{" "}
          <Link to="/settings" className="text-accent hover:underline">
            paramètres de compte
          </Link>{" "}
          (export et suppression) ou en écrivant à{" "}
          <a href="mailto:dpo@jurisai.fr" className="text-accent hover:underline">
            dpo@jurisai.fr
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="7. Sécurité">
        <p>
          Nous mettons en œuvre des mesures techniques et organisationnelles
          appropriées : chiffrement TLS, isolation multi-tenant via Row-Level
          Security, authentification forte, audits réguliers.
        </p>
      </LegalSection>

      <LegalSection title="8. Cookies">
        <p>
          Nous utilisons uniquement des cookies strictement nécessaires au
          fonctionnement du service (authentification, préférences). Aucun
          cookie publicitaire ou de mesure d'audience tiers n'est déposé sans
          votre consentement.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
