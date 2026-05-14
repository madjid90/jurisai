import { createFileRoute } from "@tanstack/react-router";
import { LegalPageShell, LegalSection } from "@/components/public/LegalPageShell";

export const Route = createFileRoute("/cgv")({
  head: () => ({
    meta: [
      { title: "Conditions générales de vente · JurisAI" },
      {
        name: "description",
        content:
          "Conditions générales de vente du service JurisAI : tarifs, abonnements, facturation, résiliation.",
      },
    ],
  }),
  component: CgvPage,
});

function CgvPage() {
  return (
    <LegalPageShell
      title="Conditions générales de vente"
      updatedAt="15 mai 2026"
    >
      <LegalSection title="1. Objet">
        <p>
          Les présentes Conditions Générales de Vente (CGV) définissent les
          modalités de souscription, de paiement et de fourniture du service
          JurisAI, plateforme SaaS d'assistance juridique et RH augmentée par
          intelligence artificielle, éditée par [À COMPLÉTER — raison sociale]
          (ci-après « l'Éditeur »).
        </p>
        <p>
          Les CGV s'appliquent à toute souscription d'un abonnement par un
          professionnel (ci-après « le Client ») : dirigeant, DRH, responsable
          RH, expert-comptable ou toute personne morale agissant dans le cadre
          de son activité professionnelle.
        </p>
      </LegalSection>

      <LegalSection title="2. Champ d'application">
        <p>
          Les présentes CGV s'appliquent à l'exclusion de toute autre condition,
          et notamment des conditions générales d'achat du Client. Toute
          commande implique l'acceptation sans réserve des présentes CGV.
        </p>
      </LegalSection>

      <LegalSection title="3. Description du service">
        <p>JurisAI propose une plateforme intégrant :</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Un agent juridique et RH intelligent (Agent 360)</li>
          <li>Une base documentaire juridique française (RAG)</li>
          <li>Un générateur de documents juridiques</li>
          <li>Un calculateur d'indemnités et de coûts sociaux</li>
          <li>Un gestionnaire de dossiers et de procédures</li>
          <li>Un système de suivi d'échéances et d'alertes</li>
        </ul>
        <p className="mt-2">
          Le service constitue une aide à la décision et à la production
          documentaire. Il ne se substitue en aucun cas à un conseil juridique
          personnalisé délivré par un avocat inscrit au barreau.
        </p>
      </LegalSection>

      <LegalSection title="4. Tarifs et modalités de paiement">
        <p>Les tarifs en vigueur sont les suivants :</p>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Offre Solo</strong> : [À COMPLÉTER]€ HT/mois — 1 utilisateur</li>
          <li><strong>Offre PME</strong> : [À COMPLÉTER]€ HT/mois — jusqu'à 5 utilisateurs</li>
          <li><strong>Offre Expert-Comptable</strong> : [À COMPLÉTER]€ HT/mois — multi-clients</li>
          <li><strong>Offre Entreprise</strong> : sur devis</li>
        </ul>
        <p className="mt-2">
          Les prix sont exprimés en euros hors taxes. La TVA applicable est celle
          en vigueur au jour de la facturation. Le paiement s'effectue par carte
          bancaire via un prestataire sécurisé (Stripe). La facturation est
          mensuelle, à terme à échoir, le 1er de chaque mois.
        </p>
        <p>
          En cas de retard de paiement, des pénalités de retard seront appliquées
          au taux de trois fois le taux d'intérêt légal, conformément à
          l'article L441-10 du Code de commerce. Une indemnité forfaitaire de 40€
          pour frais de recouvrement sera due de plein droit (article D441-5 du
          Code de commerce).
        </p>
      </LegalSection>

      <LegalSection title="5. Durée et résiliation">
        <p>
          L'abonnement est souscrit pour une durée indéterminée avec une période
          minimale d'engagement d'un (1) mois. Le Client peut résilier son
          abonnement à tout moment depuis son espace client, avec effet à la fin
          de la période de facturation en cours.
        </p>
        <p>
          L'Éditeur se réserve le droit de résilier l'abonnement en cas de
          manquement grave du Client aux présentes CGV, après mise en demeure
          restée sans effet pendant quinze (15) jours.
        </p>
        <p>
          En cas de résiliation, les données du Client restent accessibles en
          lecture seule pendant trente (30) jours, puis sont supprimées
          conformément à la politique de protection des données.
        </p>
      </LegalSection>

      <LegalSection title="6. Période d'essai">
        <p>
          Une période d'essai gratuite de [À COMPLÉTER] jours est proposée à
          tout nouveau Client. Pendant cette période, le Client bénéficie de
          l'ensemble des fonctionnalités de l'offre souscrite. À l'issue de la
          période d'essai, l'abonnement est automatiquement converti en
          abonnement payant, sauf résiliation par le Client avant la fin de
          l'essai.
        </p>
      </LegalSection>

      <LegalSection title="7. Obligations de l'Éditeur">
        <p>L'Éditeur s'engage à :</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Fournir un service disponible 99,5% du temps (hors maintenance programmée)</li>
          <li>Assurer la sécurité et la confidentialité des données du Client</li>
          <li>Mettre à jour régulièrement la base juridique</li>
          <li>Informer le Client de toute maintenance programmée avec un préavis de 48 heures</li>
          <li>Fournir un support technique par email dans un délai de 48 heures ouvrées</li>
        </ul>
      </LegalSection>

      <LegalSection title="8. Obligations du Client">
        <p>Le Client s'engage à :</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Utiliser le service conformément à sa destination professionnelle</li>
          <li>Ne pas revendre, sous-licencier ou mettre à disposition le service à des tiers</li>
          <li>Fournir des informations exactes et à jour</li>
          <li>Préserver la confidentialité de ses identifiants de connexion</li>
          <li>Ne pas tenter de contourner les mesures de sécurité du service</li>
          <li>Respecter les quotas d'utilisation de son offre</li>
        </ul>
      </LegalSection>

      <LegalSection title="9. Limitation de responsabilité">
        <p>
          <strong>JurisAI est un outil d'aide à la décision et d'information
          juridique. Il ne constitue en aucun cas un cabinet d'avocats, un
          conseil juridique personnalisé ou un avis juridique au sens de la loi
          du 31 décembre 1971.</strong>
        </p>
        <p>
          L'Éditeur ne saurait être tenu responsable des décisions prises par le
          Client sur la base des informations fournies par le service. Le Client
          est invité à consulter un avocat pour toute décision juridique
          engageante.
        </p>
        <p>
          La responsabilité totale de l'Éditeur est limitée au montant des
          sommes versées par le Client au cours des douze (12) derniers mois
          précédant le fait générateur. L'Éditeur ne pourra en aucun cas être
          tenu responsable des dommages indirects (perte de chiffre d'affaires,
          perte de données, préjudice d'image).
        </p>
      </LegalSection>

      <LegalSection title="10. Propriété intellectuelle">
        <p>
          L'ensemble du service JurisAI (logiciel, algorithmes, base de données,
          interface, documentation) est protégé par le droit de la propriété
          intellectuelle. L'abonnement confère au Client un droit d'utilisation
          personnel, non exclusif et non cessible.
        </p>
        <p>
          Les documents générés par le service pour le compte du Client
          appartiennent au Client. L'Éditeur conserve la propriété du moteur de
          génération et des modèles sous-jacents.
        </p>
      </LegalSection>

      <LegalSection title="11. Protection des données personnelles">
        <p>
          L'Éditeur traite les données personnelles du Client conformément au
          Règlement Général sur la Protection des Données (RGPD) et à la loi
          Informatique et Libertés.
        </p>
        <p>
          Pour plus d'informations sur le traitement des données, le Client est
          invité à consulter la{" "}
          <a href="/confidentialite" className="underline hover:text-foreground">
            Politique de confidentialité
          </a>.
        </p>
      </LegalSection>

      <LegalSection title="12. Droit de rétractation">
        <p>
          Conformément à l'article L221-28 du Code de la consommation, le droit
          de rétractation ne s'applique pas aux contrats conclus entre
          professionnels (B2B). Le Client reconnaît agir dans le cadre de son
          activité professionnelle et renonce expressément au bénéfice du droit
          de rétractation.
        </p>
      </LegalSection>

      <LegalSection title="13. Force majeure">
        <p>
          L'Éditeur ne saurait être tenu responsable de l'inexécution de ses
          obligations en cas de force majeure telle que définie par l'article
          1218 du Code civil, et notamment : catastrophe naturelle, incendie,
          pandémie, cyberattaque d'ampleur, défaillance d'un fournisseur
          d'infrastructure cloud, décision gouvernementale ou réglementaire.
        </p>
      </LegalSection>

      <LegalSection title="14. Modification des CGV">
        <p>
          L'Éditeur se réserve le droit de modifier les présentes CGV. Toute
          modification sera notifiée au Client par email au moins trente (30)
          jours avant son entrée en vigueur. En cas de désaccord, le Client
          pourra résilier son abonnement sans pénalité avant la date d'entrée
          en vigueur des nouvelles conditions.
        </p>
      </LegalSection>

      <LegalSection title="15. Loi applicable et juridiction">
        <p>
          Les présentes CGV sont soumises au droit français. Tout litige relatif
          à leur interprétation ou à leur exécution sera soumis à la compétence
          exclusive des tribunaux de commerce de Paris, même en cas de pluralité
          de défendeurs ou d'appel en garantie.
        </p>
      </LegalSection>

      <LegalSection title="16. Contact">
        <p>
          Pour toute question relative aux présentes CGV, le Client peut
          contacter l'Éditeur à l'adresse suivante :{" "}
          <a href="mailto:contact@jurisai.app" className="underline hover:text-foreground">
            contact@jurisai.app
          </a>
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
