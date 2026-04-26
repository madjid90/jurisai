import { createFileRoute } from "@tanstack/react-router";
import { LegalPageShell, LegalSection } from "@/components/public/LegalPageShell";

export const Route = createFileRoute("/mentions-legales")({
  head: () => ({
    meta: [
      { title: "Mentions légales · JurisAI" },
      {
        name: "description",
        content:
          "Mentions légales du service JurisAI : éditeur, hébergeur et coordonnées.",
      },
    ],
  }),
  component: MentionsLegalesPage,
});

function MentionsLegalesPage() {
  return (
    <LegalPageShell title="Mentions légales" updatedAt="26 avril 2026">
      <LegalSection title="Éditeur du site">
        <p>
          <strong>JurisAI</strong> — Société par actions simplifiée (SAS)
          <br />
          Siège social : à compléter (adresse de l'éditeur)
          <br />
          SIRET : à compléter
          <br />
          RCS : à compléter
          <br />
          Capital social : à compléter
          <br />
          Email : <a href="mailto:contact@jurisai.fr" className="text-accent hover:underline">contact@jurisai.fr</a>
        </p>
        <p>
          Directeur de la publication : représentant légal de la société.
        </p>
      </LegalSection>

      <LegalSection title="Hébergeur">
        <p>
          Le site est hébergé par <strong>Cloudflare, Inc.</strong> — 101 Townsend
          Street, San Francisco, CA 94107, États-Unis.
        </p>
        <p>
          Les bases de données et l'authentification sont opérées par{" "}
          <strong>Supabase Inc.</strong> — 970 Toa Payoh North #07-04, Singapore
          318992.
        </p>
      </LegalSection>

      <LegalSection title="Propriété intellectuelle">
        <p>
          L'ensemble des contenus présents sur le site JurisAI (textes,
          graphismes, logos, code source) est protégé par le droit d'auteur et
          appartient à JurisAI ou à ses partenaires. Toute reproduction,
          représentation ou diffusion sans autorisation préalable est
          interdite.
        </p>
      </LegalSection>

      <LegalSection title="Limitation de responsabilité">
        <p>
          JurisAI fournit un outil d'aide à la décision juridique basé sur
          l'intelligence artificielle. Les réponses générées ne constituent en
          aucun cas un conseil juridique personnalisé et ne se substituent pas
          à l'avis d'un avocat ou d'un professionnel du droit. JurisAI ne
          saurait être tenu responsable des décisions prises sur la base des
          informations fournies par le service.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Pour toute question relative au site, écrivez-nous à{" "}
          <a href="mailto:contact@jurisai.fr" className="text-accent hover:underline">
            contact@jurisai.fr
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
