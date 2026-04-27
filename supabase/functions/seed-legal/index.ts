// Edge function: seed-legal
// Seeds an initial set of French Labour Code articles into legal_sources/legal_chunks
// with embeddings. Idempotent: skips sources whose reference_code already exists.
// Auth: requires the caller to be a super_admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { embedTexts, chunkText } from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type SeedItem = {
  reference_code: string;
  title: string;
  source_type: string;
  official_url: string;
  body: string;
};

const SEED: SeedItem[] = [
  {
    reference_code: "L1221-1",
    title: "Code du travail — Article L1221-1 (Formation du contrat de travail)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006901195/",
    body: `Article L1221-1 — Formation du contrat de travail

Le contrat de travail est soumis aux règles du droit commun. Il peut être établi selon les formes que les parties contractantes décident d'adopter.

En pratique, un contrat de travail naît dès qu'il existe :
- une prestation de travail,
- une rémunération,
- un lien de subordination juridique entre l'employeur et le salarié.

L'absence d'écrit n'empêche pas l'existence du contrat (sauf pour les contrats à durée déterminée, à temps partiel et certains contrats spécifiques qui exigent un écrit).`,
  },
  {
    reference_code: "L1221-19",
    title: "Code du travail — Article L1221-19 (Période d'essai du CDI)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000019071123/",
    body: `Article L1221-19 — Période d'essai du contrat à durée indéterminée

Le contrat de travail à durée indéterminée peut comporter une période d'essai dont la durée maximale est :
- 2 mois pour les ouvriers et employés ;
- 3 mois pour les agents de maîtrise et techniciens ;
- 4 mois pour les cadres.

La période d'essai doit être expressément stipulée dans le contrat ou la lettre d'engagement. Elle peut être renouvelée une fois si un accord de branche étendu le prévoit, sans dépasser respectivement 4, 6 et 8 mois renouvellements compris.`,
  },
  {
    reference_code: "L1232-1",
    title: "Code du travail — Article L1232-1 (Cause réelle et sérieuse)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006901137/",
    body: `Article L1232-1 — Licenciement pour motif personnel : cause réelle et sérieuse

Tout licenciement pour motif personnel est motivé dans les conditions définies par le présent chapitre. Il est justifié par une cause réelle et sérieuse.

La cause doit être :
- réelle (objective, existante, vérifiable),
- et sérieuse (suffisamment grave pour justifier la rupture).

À défaut, le licenciement est sans cause réelle et sérieuse et ouvre droit à indemnisation pour le salarié.`,
  },
  {
    reference_code: "L1232-2",
    title: "Code du travail — Article L1232-2 (Entretien préalable au licenciement)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006901139/",
    body: `Article L1232-2 — Entretien préalable au licenciement

L'employeur qui envisage de licencier un salarié le convoque, avant toute décision, à un entretien préalable.

La convocation est effectuée par lettre recommandée ou remise en main propre contre décharge. Elle indique :
- l'objet de l'entretien (envisagement d'un licenciement),
- la date, l'heure et le lieu,
- la possibilité pour le salarié de se faire assister.

L'entretien ne peut avoir lieu moins de 5 jours ouvrables après la présentation de la lettre recommandée ou la remise en main propre.`,
  },
  {
    reference_code: "L1234-1",
    title: "Code du travail — Article L1234-1 (Préavis de licenciement)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006901148/",
    body: `Article L1234-1 — Préavis de licenciement

Lorsque le licenciement n'est pas motivé par une faute grave, le salarié a droit à un préavis dont la durée est déterminée comme suit :
- moins de 6 mois d'ancienneté : la durée prévue par convention collective, accord d'entreprise, usages ou contrat ;
- entre 6 mois et 2 ans : 1 mois ;
- 2 ans ou plus : 2 mois.

La convention collective peut prévoir une durée plus favorable. Le préavis n'est pas dû en cas de faute grave ou lourde, ni en cas d'inaptitude d'origine non professionnelle.`,
  },
  {
    reference_code: "L1234-9",
    title: "Code du travail — Article L1234-9 (Indemnité légale de licenciement)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000035644154/",
    body: `Article L1234-9 — Indemnité légale de licenciement

Le salarié titulaire d'un contrat de travail à durée indéterminée, licencié alors qu'il compte 8 mois d'ancienneté ininterrompus au service du même employeur, a droit, sauf en cas de faute grave, à une indemnité de licenciement.

Le taux et les modalités de calcul de cette indemnité sont fonction de la rémunération brute dont le salarié bénéficiait antérieurement à la rupture du contrat de travail.

Calcul (article R1234-2) :
- 1/4 de mois de salaire par année d'ancienneté pour les 10 premières années ;
- 1/3 de mois de salaire par année au-delà de 10 ans.

Le salaire de référence est la moyenne la plus favorable des 12 ou 3 derniers mois.`,
  },
  {
    reference_code: "L1237-1",
    title: "Code du travail — Article L1237-1 (Démission)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006901195/",
    body: `Article L1237-1 — Démission

En cas de démission, l'existence et la durée du préavis sont fixées par la loi, ou par convention ou accord collectif de travail. En l'absence de dispositions légales, de convention ou accord collectif relatifs au préavis, son existence et sa durée résultent des usages pratiqués dans la localité et la profession.

La démission doit résulter d'une volonté claire et non équivoque du salarié. Elle ne se présume pas. Une démission ambiguë (sous coup de la colère, contrainte) peut être requalifiée en prise d'acte ou licenciement sans cause réelle et sérieuse.`,
  },
  {
    reference_code: "L1237-11",
    title: "Code du travail — Article L1237-11 (Rupture conventionnelle)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000019070985/",
    body: `Article L1237-11 — Rupture conventionnelle

L'employeur et le salarié peuvent convenir en commun des conditions de la rupture du contrat de travail qui les lie. La rupture conventionnelle, exclusive du licenciement ou de la démission, ne peut être imposée par l'une ou l'autre des parties.

Procédure :
1. Au moins un entretien (le salarié peut être assisté) ;
2. Signature d'une convention de rupture précisant l'indemnité (au moins égale à l'indemnité légale de licenciement) et la date de rupture ;
3. Délai de rétractation de 15 jours calendaires ;
4. Demande d'homologation à la DREETS, qui dispose de 15 jours ouvrables ;
5. Rupture effective au plus tôt le lendemain de l'homologation.

Le salarié a droit à l'allocation chômage.`,
  },
  {
    reference_code: "L3121-27",
    title: "Code du travail — Article L3121-27 (Durée légale du travail)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033020376/",
    body: `Article L3121-27 — Durée légale du travail effectif

La durée légale de travail effectif des salariés à temps complet est fixée à 35 heures par semaine.

Cette durée est un seuil de déclenchement des heures supplémentaires, et non un maximum :
- les heures effectuées au-delà sont des heures supplémentaires,
- elles ouvrent droit à une majoration de salaire (25 % pour les 8 premières, 50 % au-delà sauf accord collectif différent),
- ou à un repos compensateur équivalent.

Durées maximales :
- 10 h par jour (12 h par dérogation) ;
- 48 h par semaine (44 h en moyenne sur 12 semaines).`,
  },
  {
    reference_code: "L3141-3",
    title: "Code du travail — Article L3141-3 (Congés payés)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033020376/",
    body: `Article L3141-3 — Acquisition des congés payés

Le salarié a droit à un congé de 2,5 jours ouvrables par mois de travail effectif chez le même employeur.

La durée totale du congé exigible ne peut excéder 30 jours ouvrables (5 semaines) pour une année complète de travail.

Sont assimilés à du travail effectif pour le calcul des congés :
- les périodes de congés payés ;
- les contreparties obligatoires en repos ;
- les périodes de congé maternité, paternité, adoption ;
- les arrêts pour accident du travail ou maladie professionnelle (dans la limite d'un an) ;
- depuis 2024, les arrêts maladie non professionnels (acquisition de 2 jours ouvrables par mois, dans la limite de 24 jours par an).`,
  },
  {
    reference_code: "L1242-1",
    title: "Code du travail — Article L1242-1 (Recours au CDD)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006901195/",
    body: `Article L1242-1 — Cas de recours au contrat à durée déterminée

Un contrat de travail à durée déterminée, quel que soit son motif, ne peut avoir ni pour objet ni pour effet de pourvoir durablement un emploi lié à l'activité normale et permanente de l'entreprise.

Cas autorisés (liste limitative, article L1242-2) :
- remplacement d'un salarié absent ;
- accroissement temporaire d'activité ;
- emplois saisonniers ou d'usage constant ;
- remplacement d'un chef d'entreprise ;
- contrats spécifiques (apprentissage, professionnalisation, etc.).

Sanction : à défaut de motif légitime, requalification en CDI avec indemnité d'au moins 1 mois de salaire.`,
  },
  {
    reference_code: "L1242-8",
    title: "Code du travail — Article L1242-8 (Durée maximale du CDD)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006901195/",
    body: `Article L1242-8 — Durée maximale du CDD

La durée totale du contrat à durée déterminée ne peut excéder 18 mois compte tenu, le cas échéant, du renouvellement.

Cette durée est ramenée à :
- 9 mois lorsque le contrat est conclu dans l'attente de l'entrée en service effective d'un salarié recruté en CDI ;
- 9 mois lorsque le contrat a pour objet la réalisation de travaux urgents nécessités par des mesures de sécurité ;
- 24 mois pour un contrat exécuté à l'étranger ou dans le cadre d'une commande exceptionnelle à l'exportation.

Un accord de branche étendu peut fixer une durée différente.`,
  },
  {
    reference_code: "L4121-1",
    title: "Code du travail — Article L4121-1 (Obligation de sécurité de l'employeur)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000035640828/",
    body: `Article L4121-1 — Obligation générale de sécurité de l'employeur

L'employeur prend les mesures nécessaires pour assurer la sécurité et protéger la santé physique et mentale des travailleurs.

Ces mesures comprennent :
1° Des actions de prévention des risques professionnels et de la pénibilité ;
2° Des actions d'information et de formation ;
3° La mise en place d'une organisation et de moyens adaptés.

L'employeur veille à l'adaptation de ces mesures pour tenir compte du changement des circonstances et tendre à l'amélioration des situations existantes.

C'est une obligation de moyens renforcée : la jurisprudence considère que l'employeur engage sa responsabilité en cas de manquement, même sans faute prouvée, dès lors qu'un risque s'est réalisé.`,
  },
  {
    reference_code: "L1152-1",
    title: "Code du travail — Article L1152-1 (Harcèlement moral)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006900818/",
    body: `Article L1152-1 — Harcèlement moral

Aucun salarié ne doit subir les agissements répétés de harcèlement moral qui ont pour objet ou pour effet une dégradation de ses conditions de travail susceptible :
- de porter atteinte à ses droits et à sa dignité,
- d'altérer sa santé physique ou mentale,
- ou de compromettre son avenir professionnel.

Le harcèlement moral est constitué indépendamment de l'intention de son auteur. Il peut être horizontal (entre collègues) ou vertical (hiérarchique).

L'employeur a une obligation de prévention (article L4121-1) et doit agir dès qu'il a connaissance de faits susceptibles de constituer du harcèlement, sous peine d'engager sa responsabilité.`,
  },
  {
    reference_code: "L2312-8",
    title: "Code du travail — Article L2312-8 (Attributions du CSE)",
    source_type: "code_travail",
    official_url:
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000035617653/",
    body: `Article L2312-8 — Attributions générales du Comité Social et Économique (CSE)

Le CSE a pour mission d'assurer une expression collective des salariés permettant la prise en compte permanente de leurs intérêts dans les décisions relatives à :
- la gestion et l'évolution économique et financière de l'entreprise ;
- l'organisation du travail ;
- la formation professionnelle ;
- les techniques de production.

Le CSE est obligatoire dans toute entreprise d'au moins 11 salariés (effectif atteint pendant 12 mois consécutifs).

Le CSE est informé et consulté sur toutes les questions intéressant l'organisation, la gestion et la marche générale de l'entreprise, notamment les mesures de nature à affecter le volume ou la structure des effectifs.`,
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      throw new Error("Missing env vars");
    }

    // Auth: must be super_admin
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = auth.replace(/^Bearer\s+/i, "");
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: u } = await userClient.auth.getUser(token);
    if (!u.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = u.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "super_admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: super_admin required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let createdSources = 0;
    let createdChunks = 0;
    let skipped = 0;

    for (const item of SEED) {
      const { data: existing } = await admin
        .from("legal_sources")
        .select("id")
        .eq("reference_code", item.reference_code)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }

      const { data: src, error: srcErr } = await admin
        .from("legal_sources")
        .insert({
          title: item.title,
          source_type: item.source_type,
          reference_code: item.reference_code,
          official_url: item.official_url,
          version_date: new Date().toISOString().slice(0, 10),
          created_by: userId,
        })
        .select("id")
        .single();
      if (srcErr || !src) {
        console.error("Insert source failed", srcErr);
        continue;
      }

      const chunks = chunkText(item.body, { targetChars: 3200, overlapChars: 200 });
      const embeddings = await embedTexts(
        LOVABLE_API_KEY,
        chunks.map((c) => `${c.heading ?? ""}\n${c.content}`),
      );

      const rows = chunks.map((c, i) => ({
        source_id: src.id,
        chunk_index: i,
        content: c.content,
        heading: c.heading,
        embedding: embeddings[i] ?? null,
        token_count: Math.ceil(c.content.length / 4),
      }));
      const { error: chunkErr } = await admin.from("legal_chunks").insert(rows);
      if (chunkErr) {
        console.error("Insert chunks failed", chunkErr);
        continue;
      }
      createdSources++;
      createdChunks += rows.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        createdSources,
        createdChunks,
        skipped,
        total: SEED.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("seed-legal error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
