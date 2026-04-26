import { createFileRoute } from "@tanstack/react-router";
import { LegalPageShell, LegalSection } from "@/components/public/LegalPageShell";

export const Route = createFileRoute("/cgu")({
  head: () => ({
    meta: [
      { title: "Conditions générales d'utilisation · JurisAI" },
      {
        name: "description",
        content:
          "Conditions générales d'utilisation du service JurisAI : accès, abonnements, responsabilités.",
      },
    ],
  }),
  component: CguPage,
});

function CguPage() {
  return (
    <LegalPageShell
      title="Conditions générales d'utilisation"
      updatedAt="26 avril 2026"
    >
      <LegalSection title="1. Objet">
        <p>
          Les présentes Conditions Générales d'Utilisation (CGU) régissent
          l'accès et l'utilisation du service JurisAI, plateforme SaaS d'aide
          à la décision juridique en droit social français destinée aux
          professionnels (DRH, juristes, avocats, experts-comptables,
          dirigeants).
        </p>
      </LegalSection>

      <LegalSection title="2. Acceptation">
        <p>
          La création d'un compte vaut acceptation pleine et entière des
          présentes CGU. L'utilisateur déclare disposer de la capacité
          juridique pour contracter et utiliser le service à titre
          professionnel.
        </p>
      </LegalSection>

      <LegalSection title="3. Description du service">
        <p>
          JurisAI propose : (i) la consultation IA en droit social, (ii) la
          génération de documents juridiques à partir de modèles, (iii) une
          veille juridique, (iv) la gestion d'équipes multi-utilisateurs.
        </p>
        <p>
          Les réponses générées par l'IA sont fournies à titre informatif. Elles
          ne constituent pas un conseil juridique au sens de la loi n°71-1130 du
          31 décembre 1971 et ne dispensent pas de consulter un avocat.
        </p>
      </LegalSection>

      <LegalSection title="4. Compte utilisateur">
        <p>
          L'utilisateur est responsable de la confidentialité de ses
          identifiants. Toute action effectuée depuis son compte est réputée
          réalisée par lui. En cas d'usage frauduleux, l'utilisateur doit en
          informer JurisAI sans délai.
        </p>
      </LegalSection>

      <LegalSection title="5. Abonnements et essai gratuit">
        <p>
          L'inscription donne accès à 14 jours d'essai gratuit sans carte
          bancaire. À l'issue, l'utilisateur peut souscrire à un plan payant
          (Starter, Pro, Business). Les abonnements sont sans engagement et
          résiliables à tout moment depuis l'espace client.
        </p>
      </LegalSection>

      <LegalSection title="6. Obligations de l'utilisateur">
        <p>L'utilisateur s'engage à :</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>utiliser le service conformément à sa destination professionnelle ;</li>
          <li>ne pas tenter de contourner les quotas ou mesures de sécurité ;</li>
          <li>ne pas extraire massivement le contenu du service (scraping) ;</li>
          <li>respecter le secret professionnel et la confidentialité des données traitées.</li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Propriété intellectuelle">
        <p>
          JurisAI conserve l'intégralité des droits sur le service, son code, sa
          marque et ses contenus. L'utilisateur dispose d'une licence
          personnelle, non-exclusive et non-cessible pendant la durée de son
          abonnement.
        </p>
      </LegalSection>

      <LegalSection title="8. Responsabilité">
        <p>
          JurisAI met en œuvre les meilleurs efforts pour garantir la fiabilité
          des réponses, sans garantie d'exactitude. L'utilisateur reste seul
          responsable des décisions prises sur la base des informations
          fournies. La responsabilité de JurisAI est plafonnée au montant des
          sommes versées par l'utilisateur au cours des 12 derniers mois.
        </p>
      </LegalSection>

      <LegalSection title="9. Résiliation">
        <p>
          L'utilisateur peut résilier son compte à tout moment depuis ses
          paramètres. JurisAI peut suspendre ou résilier un compte en cas de
          manquement grave aux présentes CGU, après mise en demeure restée sans
          effet.
        </p>
      </LegalSection>

      <LegalSection title="10. Droit applicable">
        <p>
          Les présentes CGU sont soumises au droit français. Tout litige
          relèvera de la compétence exclusive des tribunaux du ressort du siège
          social de JurisAI, sous réserve des règles impératives en matière de
          consommation.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
