ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS document_templates_slug_unique
  ON public.document_templates (slug) WHERE slug IS NOT NULL;

UPDATE public.document_templates SET slug = 'cdi' WHERE name = 'Contrat de travail à durée indéterminée (CDI)' AND slug IS NULL;
UPDATE public.document_templates SET slug = 'cdd' WHERE name = 'Contrat de travail à durée déterminée (CDD)' AND slug IS NULL;
UPDATE public.document_templates SET slug = 'attestation-employeur' WHERE name = 'Attestation employeur' AND slug IS NULL;
UPDATE public.document_templates SET slug = 'rupture-conventionnelle' WHERE name = 'Convention de rupture conventionnelle' AND slug IS NULL;
UPDATE public.document_templates SET slug = 'convocation-entretien-prealable' WHERE name = 'Convocation à entretien préalable' AND slug IS NULL;
UPDATE public.document_templates SET slug = 'avertissement' WHERE name = 'Lettre d''avertissement' AND slug IS NULL;
UPDATE public.document_templates SET slug = 'lettre-licenciement-motif-personnel' WHERE name = 'Lettre de licenciement pour motif personnel' AND slug IS NULL;
UPDATE public.document_templates SET slug = 'mise-en-demeure-payer' WHERE name = 'Mise en demeure de payer' AND slug IS NULL;

INSERT INTO public.document_templates (slug, name, description, category, risk_level, status, version, is_public, variables, legal_basis, body)
SELECT 'demande-justification-absence',
  'Demande de justification d''absence',
  'Courrier demandant au salarié de justifier son absence injustifiée',
  'Disciplinaire', 'medium', 'validated'::template_status, 1, true,
  '[{"key":"nom_salarie","label":"Nom du salarié","type":"text","required":true},{"key":"date_debut_absence","label":"Date de début de l''absence","type":"date","required":true},{"key":"poste","label":"Poste occupé","type":"text"},{"key":"raison_sociale","label":"Raison sociale employeur","type":"text","required":true},{"key":"date_courrier","label":"Date du courrier","type":"date","required":true}]'::jsonb,
  '[{"label":"Code du travail – obligation de loyauté","reference":"L1222-1"}]'::jsonb,
  E'Objet : Demande de justification d''absence\n\nMadame, Monsieur {{nom_salarie}},\n\nNous constatons votre absence depuis le {{date_debut_absence}} sans justificatif.\n\nNous vous demandons de transmettre, sous 48 heures, tout justificatif valable (arrêt de travail, certificat médical ou autre motif légitime).\n\nÀ défaut, votre absence sera considérée comme injustifiée et pourra entraîner les mesures disciplinaires prévues par la loi.\n\nFait à _____________, le {{date_courrier}}\n\n{{raison_sociale}}'
WHERE NOT EXISTS (SELECT 1 FROM public.document_templates WHERE slug = 'demande-justification-absence');

INSERT INTO public.document_templates (slug, name, description, category, risk_level, status, version, is_public, variables, legal_basis, body)
SELECT 'mise-en-demeure-reprise',
  'Mise en demeure de reprendre le travail',
  'Courrier de mise en demeure suite à absence injustifiée prolongée',
  'Disciplinaire', 'high', 'validated'::template_status, 1, true,
  '[{"key":"nom_salarie","label":"Nom du salarié","type":"text","required":true},{"key":"date_debut_absence","label":"Date de début de l''absence","type":"date","required":true},{"key":"raison_sociale","label":"Raison sociale employeur","type":"text","required":true},{"key":"date_courrier","label":"Date du courrier","type":"date","required":true}]'::jsonb,
  '[{"label":"Cass. soc. – abandon de poste","reference":"Cass. soc. 13/07/2010 n°09-40916"}]'::jsonb,
  E'Objet : Mise en demeure de reprendre le travail – LRAR\n\nMadame, Monsieur {{nom_salarie}},\n\nMalgré notre courrier précédent, vous ne nous avez fourni aucun justificatif à votre absence débutée le {{date_debut_absence}}.\n\nPar la présente, nous vous mettons en demeure de reprendre votre poste sous 48 heures ou de nous fournir un justificatif valable.\n\nÀ défaut, nous serons contraints d''engager une procédure disciplinaire pouvant aller jusqu''au licenciement pour faute grave (abandon de poste).\n\nFait à _____________, le {{date_courrier}}\n\n{{raison_sociale}}'
WHERE NOT EXISTS (SELECT 1 FROM public.document_templates WHERE slug = 'mise-en-demeure-reprise');

INSERT INTO public.document_templates (slug, name, description, category, risk_level, status, version, is_public, variables, legal_basis, body)
SELECT 'notification-sanction',
  'Notification de sanction disciplinaire',
  'Courrier notifiant la sanction prononcée à l''issue de l''entretien préalable',
  'Disciplinaire', 'high', 'validated'::template_status, 1, true,
  '[{"key":"nom_salarie","label":"Nom du salarié","type":"text","required":true},{"key":"date_entretien","label":"Date de l''entretien préalable","type":"date","required":true},{"key":"sanction","label":"Sanction prononcée","type":"select","options":["Avertissement","Blâme","Mise à pied","Rétrogradation","Licenciement"],"required":true},{"key":"motifs","label":"Motifs détaillés","type":"textarea","required":true},{"key":"raison_sociale","label":"Raison sociale employeur","type":"text","required":true},{"key":"date_courrier","label":"Date de notification","type":"date","required":true}]'::jsonb,
  '[{"label":"Délai de notification – 1 mois max après entretien","reference":"L1332-2"}]'::jsonb,
  E'Objet : Notification de sanction – LRAR\n\nMadame, Monsieur {{nom_salarie}},\n\nÀ la suite de l''entretien préalable qui s''est tenu le {{date_entretien}}, et après réflexion, nous avons décidé de prononcer à votre encontre la sanction suivante : {{sanction}}.\n\nMotifs :\n{{motifs}}\n\nCette sanction prend effet à compter de la réception de la présente. Vous disposez des voies de recours prévues par la loi et la convention collective applicable.\n\nFait à _____________, le {{date_courrier}}\n\n{{raison_sociale}}'
WHERE NOT EXISTS (SELECT 1 FROM public.document_templates WHERE slug = 'notification-sanction');

ALTER TABLE public.workflow_step_runs
  ADD COLUMN IF NOT EXISTS generated_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workflow_step_runs_doc_idx
  ON public.workflow_step_runs(generated_document_id) WHERE generated_document_id IS NOT NULL;

INSERT INTO public.rag_eval_cases (question, expected_sources, expected_answer_keywords, category, difficulty, idcc, active) VALUES
  ('Quelle est la durée légale du travail en France ?', ARRAY['L3121-27'], ARRAY['35 heures','semaine','durée légale'], 'temps_travail', 'easy', NULL, true),
  ('Quel est le délai de carence entre deux CDD sur le même poste ?', ARRAY['L1244-3'], ARRAY['tiers','durée','contrat'], 'contrat', 'medium', NULL, true),
  ('Combien de temps dure la période d''essai d''un CDI cadre ?', ARRAY['L1221-19'], ARRAY['4 mois','renouvellement','cadre'], 'contrat', 'easy', NULL, true),
  ('Quel délai légal entre la convocation et l''entretien préalable au licenciement ?', ARRAY['L1232-2'], ARRAY['5 jours ouvrables','convocation','entretien'], 'discipline', 'easy', NULL, true),
  ('Le salarié peut-il refuser une modification de son lieu de travail ?', ARRAY['L1221-1'], ARRAY['secteur géographique','clause de mobilité','contrat'], 'mobilite', 'medium', NULL, true),
  ('Quels sont les motifs de recours au CDD ?', ARRAY['L1242-2'], ARRAY['remplacement','accroissement temporaire','saisonnier'], 'contrat', 'easy', NULL, true),
  ('Quelle est l''indemnité légale de licenciement ?', ARRAY['R1234-2','L1234-9'], ARRAY['1/4','1/3','ancienneté','salaire'], 'rupture', 'medium', NULL, true),
  ('Combien de jours de congés payés un salarié acquiert-il par mois travaillé ?', ARRAY['L3141-3'], ARRAY['2,5','jours ouvrables','mois'], 'conges', 'easy', NULL, true),
  ('Le salarié peut-il être licencié pendant un arrêt maladie ?', ARRAY['L1226-9'], ARRAY['accident du travail','maladie professionnelle','protection'], 'rupture', 'hard', NULL, true),
  ('Quelle est la procédure pour une rupture conventionnelle ?', ARRAY['L1237-11','L1237-13'], ARRAY['homologation','DREETS','15 jours','rétractation'], 'rupture', 'medium', NULL, true),
  ('Délai de prescription de l''action prud''homale pour rupture du contrat ?', ARRAY['L1471-1'], ARRAY['12 mois','rupture','prescription'], 'prudhommes', 'medium', NULL, true),
  ('Le solde de tout compte est-il libératoire ?', ARRAY['L1234-20'], ARRAY['6 mois','dénonciation','signature'], 'rupture', 'medium', NULL, true),
  ('Quel est le délai de prévenance fin de période d''essai (employeur) ?', ARRAY['L1221-25'], ARRAY['24 heures','48 heures','2 semaines','1 mois'], 'contrat', 'medium', NULL, true),
  ('Quels sont les jours fériés légaux en France ?', ARRAY['L3133-1'], ARRAY['1er mai','11','jours fériés'], 'temps_travail', 'easy', NULL, true),
  ('Que doit contenir la fiche de paie obligatoirement ?', ARRAY['R3243-1'], ARRAY['mentions','cotisations','net à payer'], 'remuneration', 'medium', NULL, true),
  ('Heures supplémentaires : quelle majoration légale ?', ARRAY['L3121-36'], ARRAY['25%','50%','8 premières heures'], 'temps_travail', 'easy', NULL, true),
  ('Quelle est la durée minimale du repos quotidien ?', ARRAY['L3131-1'], ARRAY['11 heures','consécutives','repos'], 'temps_travail', 'easy', NULL, true),
  ('Procédure en cas d''abandon de poste depuis 2023 ?', ARRAY['L1237-1-1'], ARRAY['présomption de démission','mise en demeure','15 jours'], 'discipline', 'hard', NULL, true),
  ('Le télétravail peut-il être imposé au salarié ?', ARRAY['L1222-9'], ARRAY['accord','charte','volontariat'], 'organisation', 'medium', NULL, true),
  ('Délai pour engager des poursuites disciplinaires après faits ?', ARRAY['L1332-4'], ARRAY['2 mois','prescription','faits fautifs'], 'discipline', 'medium', NULL, true);