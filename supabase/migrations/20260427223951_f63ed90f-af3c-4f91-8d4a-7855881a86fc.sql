
INSERT INTO public.document_templates (name, description, category, icon, is_public, variables, body) VALUES
(
  'Contrat de travail à durée indéterminée (CDI)',
  'Modèle complet de CDI temps plein conforme au Code du travail.',
  'contrat',
  'FileSignature',
  true,
  '[
    {"key":"employeur_nom","label":"Raison sociale employeur","type":"text"},
    {"key":"employeur_siret","label":"SIRET","type":"text"},
    {"key":"employeur_adresse","label":"Adresse employeur","type":"text"},
    {"key":"employeur_representant","label":"Représenté par","type":"text"},
    {"key":"salarie_nom","label":"Nom et prénom du salarié","type":"text"},
    {"key":"salarie_adresse","label":"Adresse du salarié","type":"text"},
    {"key":"salarie_naissance","label":"Date de naissance","type":"date"},
    {"key":"salarie_nationalite","label":"Nationalité","type":"text"},
    {"key":"poste","label":"Intitulé du poste","type":"text"},
    {"key":"qualification","label":"Qualification / coefficient","type":"text"},
    {"key":"convention","label":"Convention collective","type":"text"},
    {"key":"date_debut","label":"Date de début","type":"date"},
    {"key":"lieu_travail","label":"Lieu de travail","type":"text"},
    {"key":"duree_essai","label":"Durée période d''essai","type":"text"},
    {"key":"duree_hebdo","label":"Durée hebdomadaire","type":"text"},
    {"key":"salaire_brut","label":"Salaire mensuel brut","type":"text"},
    {"key":"date_signature","label":"Date de signature","type":"date"}
  ]'::jsonb,
  '<h2>Contrat de travail à durée indéterminée</h2>
<p><strong>Entre les soussignés :</strong></p>
<p>La société <strong>{{employeur_nom}}</strong>, immatriculée sous le SIRET {{employeur_siret}}, dont le siège social est situé {{employeur_adresse}}, représentée par {{employeur_representant}},</p>
<p style="text-align:right"><em>ci-après dénommée « l''Employeur »,</em></p>
<p><strong>Et :</strong></p>
<p>{{salarie_nom}}, né(e) le {{salarie_naissance}}, de nationalité {{salarie_nationalite}}, demeurant {{salarie_adresse}},</p>
<p style="text-align:right"><em>ci-après dénommé(e) « le Salarié »,</em></p>
<p><strong>Il a été convenu ce qui suit :</strong></p>
<h3>Article 1 — Engagement</h3>
<p>L''Employeur engage le Salarié en qualité de <strong>{{poste}}</strong>, qualification {{qualification}}, à compter du {{date_debut}}, dans le cadre d''un contrat à durée indéterminée régi par la convention collective <strong>{{convention}}</strong>.</p>
<h3>Article 2 — Période d''essai</h3>
<p>Le présent contrat est conclu sous réserve d''une période d''essai de <strong>{{duree_essai}}</strong>, renouvelable une fois dans les conditions prévues par la convention collective applicable.</p>
<h3>Article 3 — Lieu de travail</h3>
<p>Le Salarié exercera ses fonctions à : {{lieu_travail}}. Toutefois, des déplacements occasionnels pourront lui être demandés dans l''intérêt de l''entreprise.</p>
<h3>Article 4 — Durée du travail</h3>
<p>La durée hebdomadaire de travail est fixée à <strong>{{duree_hebdo}}</strong>, répartie selon l''horaire en vigueur dans l''entreprise.</p>
<h3>Article 5 — Rémunération</h3>
<p>En contrepartie de son travail, le Salarié percevra une rémunération mensuelle brute de <strong>{{salaire_brut}} euros</strong>, versée mensuellement à terme échu.</p>
<h3>Article 6 — Congés payés</h3>
<p>Le Salarié bénéficiera des congés payés conformément aux dispositions légales et conventionnelles en vigueur.</p>
<h3>Article 7 — Obligations</h3>
<p>Le Salarié s''engage à respecter les directives qui lui seront données, ainsi que le règlement intérieur et les procédures de l''entreprise. Il est tenu à une obligation de loyauté et de confidentialité.</p>
<h3>Article 8 — Rupture du contrat</h3>
<p>Le présent contrat pourra être rompu à tout moment, à l''initiative de l''une ou l''autre des parties, dans le respect des dispositions légales et conventionnelles applicables, notamment en matière de préavis.</p>
<p style="margin-top:32px">Fait à __________________, le {{date_signature}}, en deux exemplaires originaux.</p>
<p style="margin-top:48px"><strong>L''Employeur</strong> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>Le Salarié</strong></p>
<p><em>(signature précédée de la mention « Lu et approuvé »)</em></p>'
),
(
  'Convention de rupture conventionnelle',
  'Convention de rupture conventionnelle individuelle (Articles L1237-11 à L1237-16 du Code du travail).',
  'contrat',
  'Scale',
  true,
  '[
    {"key":"employeur_nom","label":"Raison sociale employeur","type":"text"},
    {"key":"employeur_adresse","label":"Adresse employeur","type":"text"},
    {"key":"employeur_representant","label":"Représenté par","type":"text"},
    {"key":"salarie_nom","label":"Nom et prénom du salarié","type":"text"},
    {"key":"salarie_adresse","label":"Adresse du salarié","type":"text"},
    {"key":"poste","label":"Poste occupé","type":"text"},
    {"key":"date_embauche","label":"Date d''embauche","type":"date"},
    {"key":"anciennete","label":"Ancienneté","type":"text"},
    {"key":"date_entretien","label":"Date du premier entretien","type":"date"},
    {"key":"indemnite_montant","label":"Montant de l''indemnité spécifique (€)","type":"text"},
    {"key":"date_rupture","label":"Date envisagée de rupture","type":"date"},
    {"key":"date_signature","label":"Date de signature","type":"date"}
  ]'::jsonb,
  '<h2>Convention de rupture conventionnelle du contrat de travail</h2>
<p><em>Articles L. 1237-11 et suivants du Code du travail</em></p>
<p><strong>Entre :</strong></p>
<p>{{employeur_nom}}, dont le siège social est situé {{employeur_adresse}}, représentée par {{employeur_representant}},</p>
<p style="text-align:right"><em>ci-après « l''Employeur »,</em></p>
<p><strong>Et :</strong></p>
<p>{{salarie_nom}}, demeurant {{salarie_adresse}}, exerçant les fonctions de <strong>{{poste}}</strong>, embauché(e) le {{date_embauche}}, ancienneté : {{anciennete}},</p>
<p style="text-align:right"><em>ci-après « le Salarié »,</em></p>
<p><strong>Il a été convenu ce qui suit :</strong></p>
<h3>Article 1 — Objet</h3>
<p>La présente convention a pour objet de définir les conditions de la rupture d''un commun accord du contrat de travail liant les parties, conformément aux articles L. 1237-11 et suivants du Code du travail.</p>
<h3>Article 2 — Entretien(s) préalable(s)</h3>
<p>Les parties se sont rencontrées le {{date_entretien}} afin de discuter du principe et des modalités de la rupture conventionnelle. Le Salarié a été informé de la possibilité de se faire assister.</p>
<h3>Article 3 — Indemnité spécifique de rupture</h3>
<p>L''Employeur versera au Salarié une <strong>indemnité spécifique de rupture conventionnelle</strong> d''un montant brut de <strong>{{indemnite_montant}} €</strong>, conformément aux dispositions légales et conventionnelles applicables.</p>
<h3>Article 4 — Date de rupture</h3>
<p>La date envisagée de rupture du contrat de travail est fixée au <strong>{{date_rupture}}</strong>, sous réserve de l''homologation de la convention par l''autorité administrative compétente (DREETS).</p>
<h3>Article 5 — Délai de rétractation</h3>
<p>À compter de la signature de la présente convention, chaque partie dispose d''un <strong>délai de 15 jours calendaires</strong> pour exercer son droit de rétractation, par lettre recommandée avec accusé de réception.</p>
<h3>Article 6 — Homologation</h3>
<p>À l''issue du délai de rétractation, la convention sera adressée pour homologation à la DREETS compétente. L''autorité administrative dispose d''un délai de 15 jours ouvrables pour statuer.</p>
<h3>Article 7 — Documents de fin de contrat</h3>
<p>L''Employeur remettra au Salarié, à la date effective de rupture, le certificat de travail, le reçu pour solde de tout compte et l''attestation destinée à France Travail.</p>
<p style="margin-top:32px">Fait à __________________, le {{date_signature}}, en trois exemplaires originaux.</p>
<p style="margin-top:48px"><strong>L''Employeur</strong> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>Le Salarié</strong></p>'
),
(
  'Attestation employeur',
  'Attestation employeur générique pour démarches administratives ou bancaires.',
  'courrier',
  'FileText',
  true,
  '[
    {"key":"employeur_nom","label":"Raison sociale","type":"text"},
    {"key":"employeur_adresse","label":"Adresse employeur","type":"text"},
    {"key":"employeur_representant","label":"Représenté par","type":"text"},
    {"key":"salarie_nom","label":"Nom et prénom du salarié","type":"text"},
    {"key":"poste","label":"Poste occupé","type":"text"},
    {"key":"type_contrat","label":"Type de contrat (CDI, CDD…)","type":"text"},
    {"key":"date_embauche","label":"Date d''embauche","type":"date"},
    {"key":"salaire_brut","label":"Salaire mensuel brut (€)","type":"text"},
    {"key":"objet","label":"Destinataire / Objet (ex : valoir ce que de droit)","type":"text"},
    {"key":"date_signature","label":"Date d''émission","type":"date"}
  ]'::jsonb,
  '<h2>Attestation employeur</h2>
<p style="text-align:right">Fait à __________________, le {{date_signature}}</p>
<p><strong>{{employeur_nom}}</strong><br/>{{employeur_adresse}}</p>
<p style="margin-top:24px"><strong>Objet :</strong> {{objet}}</p>
<p style="margin-top:24px">Je soussigné(e), <strong>{{employeur_representant}}</strong>, agissant en qualité de représentant légal de la société {{employeur_nom}}, atteste par la présente que :</p>
<p><strong>{{salarie_nom}}</strong> est employé(e) au sein de notre société depuis le <strong>{{date_embauche}}</strong>, dans le cadre d''un contrat de travail à <strong>{{type_contrat}}</strong>, en qualité de <strong>{{poste}}</strong>.</p>
<p>À ce jour, son contrat de travail est toujours en cours et ne fait l''objet d''aucune procédure de rupture, ni démission, ni licenciement.</p>
<p>Sa rémunération mensuelle brute s''élève à <strong>{{salaire_brut}} €</strong>.</p>
<p>La présente attestation est délivrée à l''intéressé(e) pour faire valoir ce que de droit.</p>
<p style="margin-top:48px">{{employeur_representant}}<br/><em>Signature et cachet de l''entreprise</em></p>'
),
(
  'Convocation à entretien préalable',
  'Convocation à un entretien préalable à un éventuel licenciement (Article L1232-2 du Code du travail).',
  'courrier',
  'FileWarning',
  true,
  '[
    {"key":"employeur_nom","label":"Raison sociale","type":"text"},
    {"key":"employeur_adresse","label":"Adresse employeur","type":"text"},
    {"key":"employeur_representant","label":"Représenté par","type":"text"},
    {"key":"salarie_nom","label":"Nom et prénom du salarié","type":"text"},
    {"key":"salarie_adresse","label":"Adresse du salarié","type":"text"},
    {"key":"date_envoi","label":"Date d''envoi","type":"date"},
    {"key":"date_entretien","label":"Date de l''entretien","type":"date"},
    {"key":"heure_entretien","label":"Heure de l''entretien","type":"text"},
    {"key":"lieu_entretien","label":"Lieu de l''entretien","type":"text"},
    {"key":"adresse_inspection","label":"Adresse Inspection du travail (si moins de 11 salariés)","type":"text"}
  ]'::jsonb,
  '<h2>Convocation à entretien préalable à un éventuel licenciement</h2>
<p style="text-align:right">{{employeur_nom}}<br/>{{employeur_adresse}}</p>
<p>{{salarie_nom}}<br/>{{salarie_adresse}}</p>
<p style="text-align:right; margin-top:16px">Le {{date_envoi}}</p>
<p><strong>Lettre recommandée avec accusé de réception<br/>(ou remise en main propre contre décharge)</strong></p>
<p style="margin-top:16px"><strong>Objet :</strong> Convocation à un entretien préalable</p>
<p>Madame, Monsieur,</p>
<p>Nous envisageons à votre encontre une mesure de licenciement en raison de faits que nous souhaitons évoquer avec vous.</p>
<p>En application des articles L. 1232-2 et suivants du Code du travail, nous vous convoquons à un entretien préalable qui se tiendra le :</p>
<p style="text-align:center; margin:16px 0"><strong>{{date_entretien}} à {{heure_entretien}}</strong><br/>{{lieu_entretien}}</p>
<p>Au cours de cet entretien, nous vous exposerons les motifs de la mesure envisagée et recueillerons vos explications.</p>
<p>Conformément à l''article L. 1232-4 du Code du travail, vous avez la possibilité de vous faire assister, soit par une personne de votre choix appartenant au personnel de l''entreprise, soit, en l''absence d''institutions représentatives du personnel, par un conseiller du salarié choisi sur une liste consultable :</p>
<ul>
<li>à la mairie de votre domicile ;</li>
<li>à l''inspection du travail : {{adresse_inspection}}.</li>
</ul>
<p>Nous vous prions de croire, Madame, Monsieur, à l''assurance de nos salutations distinguées.</p>
<p style="margin-top:48px">{{employeur_representant}}<br/>{{employeur_nom}}</p>'
);
