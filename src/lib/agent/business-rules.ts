// Règles métier pour les 3 modales agent (Info manquante / Confirmation / Validation humaine).
// Mapping (intent, domain, topic_keyword) → textes, risques, étapes, destinataires de validation.
//
// Utilisé par AgentResultCard pour passer du squelette générique à des modales contextualisées
// par domaine juridique (RH, commercial, sociétés, RGPD, fiscal, contentieux, administratif).

import type { AgentRunOutput } from "@/lib/agent/agent.functions";

export type RuleKind =
  | "rupture_conventionnelle"
  | "licenciement"
  | "sanction_disciplinaire"
  | "embauche"
  | "mise_en_demeure"
  | "rupture_contrat_commercial"
  | "transaction"
  | "contentieux"
  | "depot_legal"
  | "modification_statuts"
  | "rgpd_violation"
  | "redressement_fiscal"
  | "generic";

export type BusinessRule = {
  kind: RuleKind;
  /** Titre affiché en tête de modale. */
  title: string;
  /** Sous-titre / accroche. */
  subtitle?: string;
  /** Champs à demander (questions structurées) — ordre = priorité. */
  required_fields: Array<{
    key: string;
    label: string;
    placeholder?: string;
    type?: "text" | "date" | "number" | "textarea";
    hint?: string;
  }>;
  /** Risques juridiques majeurs à afficher en confirmation. */
  risks: string[];
  /** Étapes à exécuter (workflow simplifié, pour la confirmation). */
  steps: string[];
  /** Rôles destinataires d'une validation humaine. */
  validation_roles: Array<"juriste" | "rh_manager" | "dirigeant" | "daf" | "dpo">;
  /** Délai indicatif de validation (jours). */
  validation_sla_days?: number;
};

/* ---------------------------------------------------------------- */
/* Catalogue de règles                                              */
/* ---------------------------------------------------------------- */

export const RULES: Record<RuleKind, BusinessRule> = {
  rupture_conventionnelle: {
    kind: "rupture_conventionnelle",
    title: "Rupture conventionnelle",
    subtitle: "Procédure homologuée par la DREETS — quelques infos avant de préparer le dossier.",
    required_fields: [
      { key: "salarie_nom", label: "Nom complet du salarié", placeholder: "Ex. Jean Dupont" },
      { key: "salarie_anciennete", label: "Ancienneté (années)", type: "number", placeholder: "Ex. 4.5" },
      { key: "salaire_brut", label: "Salaire mensuel brut (€)", type: "number" },
      { key: "date_envisagee", label: "Date de rupture envisagée", type: "date" },
      { key: "motif", label: "Motif principal", type: "textarea", placeholder: "Contexte, raison opérationnelle…" },
    ],
    risks: [
      "Indemnité spécifique ≥ indemnité légale de licenciement (sinon nullité).",
      "Délai de rétractation de 15 jours calendaires post-signature.",
      "Homologation DREETS sous 15 jours ouvrables — refus possible.",
      "Risque de requalification en licenciement sans cause si vice du consentement.",
    ],
    steps: [
      "Préparer le formulaire CERFA 14598*01.",
      "Convoquer le salarié à au moins un entretien (avec assistance possible).",
      "Signer la convention de rupture.",
      "Démarrer le délai de rétractation (15 jours).",
      "Transmettre la demande d'homologation à la DREETS.",
      "Calculer et programmer le solde de tout compte.",
    ],
    validation_roles: ["rh_manager", "juriste"],
    validation_sla_days: 2,
  },

  licenciement: {
    kind: "licenciement",
    title: "Licenciement",
    subtitle: "Procédure à fort risque prud'homal — validation juriste obligatoire.",
    required_fields: [
      { key: "salarie_nom", label: "Nom complet du salarié" },
      { key: "type_motif", label: "Type de motif", placeholder: "personnel / disciplinaire / économique" },
      { key: "faits", label: "Faits / éléments matériels", type: "textarea" },
      { key: "date_decouverte", label: "Date de découverte des faits", type: "date" },
    ],
    risks: [
      "Prescription disciplinaire de 2 mois (art. L.1332-4 CT).",
      "Procédure obligatoire : convocation 5 jours ouvrables, entretien préalable, notification motivée.",
      "Risque de licenciement sans cause réelle et sérieuse → indemnité barème Macron.",
      "Risque de nullité (discrimination, harcèlement, lanceur d'alerte) → réintégration possible.",
    ],
    steps: [
      "Vérifier la prescription (2 mois) et l'absence de discrimination.",
      "Convoquer à l'entretien préalable (LRAR ou remise en main propre).",
      "Tenir l'entretien (≥ 5 jours ouvrables après convocation).",
      "Notifier le licenciement (motifs précis, ≥ 2 jours ouvrables après entretien).",
      "Établir reçu pour solde de tout compte, certificat de travail, attestation France Travail.",
    ],
    validation_roles: ["juriste", "rh_manager", "dirigeant"],
    validation_sla_days: 3,
  },

  sanction_disciplinaire: {
    kind: "sanction_disciplinaire",
    title: "Sanction disciplinaire",
    subtitle: "Avertissement, mise à pied, rétrogradation… procédure encadrée.",
    required_fields: [
      { key: "salarie_nom", label: "Nom du salarié" },
      { key: "niveau_sanction", label: "Niveau envisagé", placeholder: "avertissement / mise à pied / rétrogradation" },
      { key: "faits", label: "Faits reprochés", type: "textarea" },
      { key: "date_faits", label: "Date des faits", type: "date" },
    ],
    risks: [
      "Prescription de 2 mois à compter de la connaissance des faits.",
      "Au-delà de l'avertissement : entretien préalable obligatoire.",
      "Sanction pécuniaire interdite.",
      "Double sanction interdite pour les mêmes faits.",
    ],
    steps: [
      "Vérifier la prescription.",
      "Si > avertissement : convoquer à un entretien préalable.",
      "Notifier la sanction par écrit (motifs).",
      "Inscrire au dossier disciplinaire.",
    ],
    validation_roles: ["rh_manager", "juriste"],
    validation_sla_days: 1,
  },

  embauche: {
    kind: "embauche",
    title: "Embauche",
    subtitle: "Préparer le contrat et les déclarations préalables.",
    required_fields: [
      { key: "candidat_nom", label: "Nom du candidat" },
      { key: "type_contrat", label: "Type de contrat", placeholder: "CDI / CDD / alternance / stage" },
      { key: "poste", label: "Intitulé du poste" },
      { key: "date_debut", label: "Date d'entrée prévue", type: "date" },
      { key: "remuneration", label: "Rémunération brute annuelle (€)", type: "number" },
    ],
    risks: [
      "DPAE obligatoire dans les 8 jours précédant l'embauche.",
      "Visite d'information et de prévention (VIP) à programmer.",
      "Période d'essai à mentionner expressément (sinon non opposable).",
      "Vérifier la convention collective applicable (IDCC).",
    ],
    steps: [
      "Effectuer la DPAE (URSSAF).",
      "Rédiger et faire signer le contrat de travail.",
      "Programmer la VIP auprès de la médecine du travail.",
      "Inscrire au registre unique du personnel.",
      "Affilier aux organismes sociaux (mutuelle, prévoyance, retraite).",
    ],
    validation_roles: ["rh_manager"],
    validation_sla_days: 1,
  },

  mise_en_demeure: {
    kind: "mise_en_demeure",
    title: "Mise en demeure",
    subtitle: "Acte préalable à toute action contentieuse.",
    required_fields: [
      { key: "destinataire", label: "Destinataire (raison sociale + adresse)", type: "textarea" },
      { key: "objet", label: "Objet (impayé, inexécution, …)" },
      { key: "montant", label: "Montant en jeu (€)", type: "number" },
      { key: "delai", label: "Délai laissé pour s'exécuter (jours)", type: "number", placeholder: "8" },
    ],
    risks: [
      "Forme : LRAR ou acte de commissaire de justice (sinon point de départ des intérêts contesté).",
      "Doit être suffisamment précise (objet, montant, délai, fondement).",
      "Constitue un préalable obligatoire à de nombreuses actions (résolution, dommages-intérêts).",
      "Délai raisonnable obligatoire (généralement 8 à 15 jours).",
    ],
    steps: [
      "Rédiger la mise en demeure (objet, fondement, montant, délai, sanction).",
      "Envoyer par LRAR (ou commissaire de justice si enjeu élevé).",
      "Archiver l'AR.",
      "Programmer le suivi à l'expiration du délai.",
    ],
    validation_roles: ["juriste"],
    validation_sla_days: 1,
  },

  rupture_contrat_commercial: {
    kind: "rupture_contrat_commercial",
    title: "Rupture de contrat commercial",
    subtitle: "Attention au préavis et à la rupture brutale (art. L.442-1 C. com.).",
    required_fields: [
      { key: "partenaire", label: "Partenaire commercial" },
      { key: "anciennete_relation", label: "Ancienneté de la relation (années)", type: "number" },
      { key: "ca_annuel", label: "CA annuel généré par la relation (€)", type: "number" },
      { key: "motif", label: "Motif de la rupture", type: "textarea" },
    ],
    risks: [
      "Rupture brutale sanctionnée si préavis insuffisant (art. L.442-1, II C. com.).",
      "Préavis indicatif : ~1 mois par année de relation, plafonné à 18 mois.",
      "Risque d'indemnisation = marge brute perdue durant le préavis manquant.",
      "Notification écrite obligatoire (LRAR).",
    ],
    steps: [
      "Évaluer le préavis raisonnable (ancienneté, dépendance économique, exclusivité).",
      "Notifier la rupture par LRAR avec préavis explicite.",
      "Maintenir les conditions habituelles durant le préavis.",
      "Documenter les motifs (preuve en cas de contentieux).",
    ],
    validation_roles: ["juriste", "dirigeant"],
    validation_sla_days: 3,
  },

  transaction: {
    kind: "transaction",
    title: "Transaction",
    subtitle: "Accord transactionnel — concessions réciproques, irrévocable une fois signé.",
    required_fields: [
      { key: "partie_adverse", label: "Partie adverse" },
      { key: "objet_litige", label: "Objet du litige", type: "textarea" },
      { key: "montant_propose", label: "Montant proposé (€)", type: "number" },
      { key: "concessions", label: "Concessions réciproques", type: "textarea" },
    ],
    risks: [
      "Doit comporter des concessions réciproques réelles (sinon nullité).",
      "Autorité de la chose jugée entre les parties (art. 2052 C. civ.).",
      "Irrévocable sauf vice du consentement.",
      "Rédaction écrite indispensable (preuve).",
    ],
    steps: [
      "Identifier le litige précis et les prétentions de chaque partie.",
      "Formaliser les concessions réciproques.",
      "Rédiger le protocole transactionnel.",
      "Faire signer chaque page + dernière page paraphée.",
      "Archiver l'original.",
    ],
    validation_roles: ["juriste", "dirigeant"],
    validation_sla_days: 5,
  },

  contentieux: {
    kind: "contentieux",
    title: "Ouverture de contentieux",
    subtitle: "Validation dirigeant requise — engagement de frais et risque réputationnel.",
    required_fields: [
      { key: "partie_adverse", label: "Partie adverse" },
      { key: "juridiction", label: "Juridiction envisagée", placeholder: "TJ / Prud'hommes / TC / TA…" },
      { key: "objet", label: "Objet de la demande", type: "textarea" },
      { key: "enjeu", label: "Enjeu financier (€)", type: "number" },
    ],
    risks: [
      "Frais d'avocat, d'huissier, d'expertise non récupérables intégralement.",
      "Délai de procédure : souvent 12 à 36 mois.",
      "Risque réputationnel.",
      "Article 700 / dépens en cas de perte.",
    ],
    steps: [
      "Vérifier la prescription applicable.",
      "Tenter une résolution amiable (mise en demeure, médiation).",
      "Choisir l'avocat / le conseil.",
      "Préparer l'assignation et les pièces.",
      "Signifier et enrôler.",
    ],
    validation_roles: ["juriste", "dirigeant"],
    validation_sla_days: 5,
  },

  depot_legal: {
    kind: "depot_legal",
    title: "Dépôt légal / formalité société",
    subtitle: "Greffe du tribunal de commerce — délais stricts.",
    required_fields: [
      { key: "type_formalite", label: "Type de formalité", placeholder: "comptes annuels / modif statuts / dissolution…" },
      { key: "date_evenement", label: "Date de l'événement", type: "date" },
    ],
    risks: [
      "Comptes annuels : dépôt sous 1 mois après AGO (2 mois si dépôt en ligne).",
      "Modifications statutaires : 1 mois après l'AG.",
      "Sanctions pénales possibles en cas de défaut.",
      "Injonction sous astreinte du président du tribunal.",
    ],
    steps: [
      "Préparer le dossier (PV, statuts à jour, formulaires Cerfa).",
      "Déposer sur le guichet unique INPI.",
      "Régler les frais de greffe.",
      "Conserver le récépissé.",
    ],
    validation_roles: ["juriste", "daf"],
    validation_sla_days: 2,
  },

  modification_statuts: {
    kind: "modification_statuts",
    title: "Modification des statuts",
    subtitle: "Formalisme corporate strict.",
    required_fields: [
      { key: "objet_modification", label: "Objet de la modification", type: "textarea" },
      { key: "date_ag", label: "Date d'AG envisagée", type: "date" },
    ],
    risks: [
      "Quorum et majorité variables selon la nature de la modification (SAS/SARL/SA).",
      "Publicité au journal d'annonces légales obligatoire.",
      "Dépôt au greffe sous 1 mois.",
      "Inopposabilité aux tiers tant que non publiée.",
    ],
    steps: [
      "Convoquer l'AG (préavis statutaire).",
      "Tenir l'AG, rédiger le PV.",
      "Mettre à jour les statuts.",
      "Publier au JAL.",
      "Déposer au guichet unique INPI.",
    ],
    validation_roles: ["juriste", "dirigeant"],
    validation_sla_days: 3,
  },

  rgpd_violation: {
    kind: "rgpd_violation",
    title: "Violation de données personnelles",
    subtitle: "Notification CNIL sous 72h si risque pour les personnes.",
    required_fields: [
      { key: "nature", label: "Nature de la violation", type: "textarea" },
      { key: "date_decouverte", label: "Date de découverte", type: "date" },
      { key: "personnes_concernees", label: "Nombre de personnes concernées", type: "number" },
      { key: "donnees_concernees", label: "Catégories de données", type: "textarea" },
    ],
    risks: [
      "Délai de notification CNIL : 72h après prise de connaissance (art. 33 RGPD).",
      "Information des personnes concernées si risque élevé (art. 34 RGPD).",
      "Sanctions jusqu'à 20 M€ ou 4 % du CA mondial.",
      "Obligation d'inscription au registre des violations.",
    ],
    steps: [
      "Qualifier la violation (confidentialité / intégrité / disponibilité).",
      "Évaluer le risque pour les personnes.",
      "Notifier la CNIL via le téléservice (sous 72h).",
      "Informer les personnes concernées si risque élevé.",
      "Inscrire au registre interne des violations.",
      "Mettre en place les mesures correctives.",
    ],
    validation_roles: ["dpo", "juriste", "dirigeant"],
    validation_sla_days: 1,
  },

  redressement_fiscal: {
    kind: "redressement_fiscal",
    title: "Redressement / contrôle fiscal",
    subtitle: "Procédure contradictoire — délais de réponse impératifs.",
    required_fields: [
      { key: "type_controle", label: "Type", placeholder: "vérification de comptabilité / examen / contrôle sur pièces" },
      { key: "date_proposition", label: "Date de la proposition de rectification", type: "date" },
      { key: "montant_redressement", label: "Montant notifié (€)", type: "number" },
    ],
    risks: [
      "Délai de réponse de 30 jours (prorogation possible 30 jours).",
      "Acquiescement implicite si pas de réponse motivée.",
      "Pénalités jusqu'à 80 % en cas de manœuvres frauduleuses.",
      "Recours hiérarchique puis contentieux possibles.",
    ],
    steps: [
      "Analyser la proposition de rectification.",
      "Solliciter la prorogation du délai si besoin.",
      "Préparer la réponse motivée (faits + droit).",
      "Recours hiérarchique le cas échéant.",
      "Saisir la commission départementale ou le juge en cas d'échec.",
    ],
    validation_roles: ["daf", "juriste", "dirigeant"],
    validation_sla_days: 2,
  },

  generic: {
    kind: "generic",
    title: "Action juridique",
    subtitle: "Quelques précisions avant de continuer.",
    required_fields: [],
    risks: [],
    steps: [],
    validation_roles: ["juriste"],
    validation_sla_days: 2,
  },
};

/* ---------------------------------------------------------------- */
/* Sélection de règle                                               */
/* ---------------------------------------------------------------- */

const KEYWORDS: Array<[RegExp, RuleKind]> = [
  [/rupture\s+convention/i, "rupture_conventionnelle"],
  [/licenci/i, "licenciement"],
  [/(sanction|avertissement|mise\s+à\s+pied|rétrogradation)/i, "sanction_disciplinaire"],
  [/(embauche|recrutement|cdi|cdd|dpae)/i, "embauche"],
  [/mise\s+en\s+demeure/i, "mise_en_demeure"],
  [/(rupture.*commercial|fin.*partenariat|résiliation.*contrat)/i, "rupture_contrat_commercial"],
  [/transaction|protocole\s+transactionnel/i, "transaction"],
  [/(contentieux|assignation|prud['']?hommes|tribunal)/i, "contentieux"],
  [/(comptes\s+annuels|dépôt\s+greffe|formalité)/i, "depot_legal"],
  [/(modification\s+statuts|changement\s+gérant|transfert\s+siège)/i, "modification_statuts"],
  [/(violation.*données|fuite.*données|incident\s+rgpd|data\s+breach)/i, "rgpd_violation"],
  [/(redressement|contrôle\s+fiscal|proposition\s+de\s+rectification)/i, "redressement_fiscal"],
];

/**
 * Sélectionne la règle métier la plus adaptée au résultat agent
 * en se basant sur le topic, les actions suggérées et le message.
 */
export function pickRule(result: AgentRunOutput, hintMessage?: string): BusinessRule {
  const haystack = [
    result.topic,
    ...result.suggested_actions.map((a) => a.label),
    hintMessage ?? "",
  ]
    .join(" ")
    .toLowerCase();

  for (const [re, kind] of KEYWORDS) {
    if (re.test(haystack)) return RULES[kind];
  }
  return RULES.generic;
}

export const ROLE_LABEL: Record<BusinessRule["validation_roles"][number], string> = {
  juriste: "Juriste",
  rh_manager: "Responsable RH",
  dirigeant: "Dirigeant",
  daf: "DAF / Comptable",
  dpo: "DPO",
};
