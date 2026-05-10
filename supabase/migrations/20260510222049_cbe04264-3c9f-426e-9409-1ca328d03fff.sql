INSERT INTO public.rag_eval_cases (question, expected_sources, expected_answer_keywords, category, difficulty, idcc) VALUES
-- RGPD / données personnelles
('Quel est le délai pour répondre à une demande d''accès RGPD d''un salarié ?', ARRAY['rgpd','cnil_doctrine'], ARRAY['un mois','article 12','RGPD','prolongation deux mois'], 'rgpd', 'easy', NULL),
('Une entreprise doit-elle nommer un DPO obligatoirement ?', ARRAY['rgpd','cnil_doctrine'], ARRAY['article 37','autorité publique','suivi régulier','grande échelle'], 'rgpd', 'medium', NULL),
('Quelle sanction maximale pour une violation RGPD majeure ?', ARRAY['rgpd'], ARRAY['20 millions','4%','chiffre d''affaires mondial'], 'rgpd', 'easy', NULL),
('Combien de temps conserver les CV des candidats non retenus ?', ARRAY['cnil_doctrine','cnil_deliberation'], ARRAY['deux ans','consentement','suppression'], 'rgpd', 'medium', NULL),
-- Sociétés
('Quel capital minimum pour créer une SAS ?', ARRAY['code_article','loi'], ARRAY['1 euro','aucun minimum','libération'], 'societes', 'easy', NULL),
('Délai pour déposer les comptes annuels au greffe d''une SARL ?', ARRAY['code_article'], ARRAY['un mois','assemblée','approbation','sept mois'], 'societes', 'medium', NULL),
('Procédure de révocation d''un gérant de SARL non statutaire ?', ARRAY['code_article'], ARRAY['majorité','justes motifs','dommages-intérêts','article L223-25'], 'societes', 'hard', NULL),
('Quelles formalités pour transférer le siège social d''une SAS ?', ARRAY['code_article'], ARRAY['décision président','statuts','RCS','publication'], 'societes', 'medium', NULL),
-- Contrats commerciaux
('Délai légal de paiement entre professionnels en France ?', ARRAY['code_article','loi'], ARRAY['60 jours','45 jours fin de mois','LME','article L441-10'], 'commercial', 'easy', NULL),
('Conditions de validité d''une clause de non-concurrence commerciale ?', ARRAY['code_article','jurisprudence'], ARRAY['limitée','temps','espace','intérêt légitime','proportionnée'], 'commercial', 'hard', NULL),
('Indemnité de rupture brutale de relations commerciales établies ?', ARRAY['code_article','jurisprudence'], ARRAY['L442-1','préavis','marge brute','durée'], 'commercial', 'hard', NULL),
('Délai de prescription en matière commerciale entre professionnels ?', ARRAY['code_article'], ARRAY['cinq ans','L110-4','prescription'], 'commercial', 'medium', NULL),
-- Fiscal
('Seuil de la franchise en base de TVA pour une prestation de service en 2025 ?', ARRAY['bofip','code_article'], ARRAY['37 500','franchise','TVA','prestations'], 'fiscal', 'medium', NULL),
('Taux d''impôt sur les sociétés réduit pour les PME ?', ARRAY['bofip','code_article'], ARRAY['15%','42 500','bénéfice','PME'], 'fiscal', 'easy', NULL),
('Délai de conservation des factures pour le fisc ?', ARRAY['bofip','code_article'], ARRAY['six ans','dix ans','livre des procédures fiscales'], 'fiscal', 'easy', NULL),
-- Contentieux
('Délai pour saisir le conseil de prud''hommes après un licenciement ?', ARRAY['code_article'], ARRAY['douze mois','L1471-1','prescription'], 'contentieux', 'easy', NULL),
('Procédure de référé prud''homal : conditions ?', ARRAY['code_article'], ARRAY['urgence','non sérieusement contestable','trouble manifestement illicite'], 'contentieux', 'medium', NULL),
('Délai d''appel d''un jugement civil ?', ARRAY['code_article'], ARRAY['un mois','signification','article 538'], 'contentieux', 'easy', NULL),
-- RH avancé
('Conditions pour mettre en place le télétravail régulier ?', ARRAY['code_article','convention_collective'], ARRAY['accord collectif','charte','accord individuel','L1222-9'], 'temps_travail', 'medium', NULL),
('Calcul de l''indemnité de licenciement pour un salarié ayant 12 ans d''ancienneté ?', ARRAY['code_article'], ARRAY['1/4 mois','1/3 au-delà de dix ans','R1234-2','salaire de référence'], 'rupture', 'medium', NULL),
('Procédure d''un licenciement pour inaptitude d''origine non professionnelle ?', ARRAY['code_article'], ARRAY['avis médecin du travail','reclassement','consultation CSE','L1226-2'], 'rupture', 'hard', NULL),
('Quelles obligations pour un PSE dans une entreprise de 60 salariés ?', ARRAY['code_article'], ARRAY['plus de 50','dix licenciements','L1233-61','plan de sauvegarde'], 'rupture', 'hard', NULL),
('Indemnités journalières pour arrêt maladie après 6 mois d''ancienneté ?', ARRAY['code_article','convention_collective'], ARRAY['90%','complément employeur','délai de carence','L1226-1'], 'maladie', 'medium', NULL),
-- Sécurité / discrimination
('Définition légale du harcèlement moral au travail ?', ARRAY['code_article','jurisprudence'], ARRAY['L1152-1','agissements répétés','dégradation','dignité'], 'discrimination', 'medium', NULL),
('Obligations de l''employeur en matière de DUERP ?', ARRAY['code_article'], ARRAY['document unique','évaluation des risques','mise à jour','L4121-3'], 'securite', 'medium', NULL),
-- Réglementation métier
('Obligation d''une assurance RC pro pour un consultant indépendant ?', ARRAY['code_article','loi'], ARRAY['non obligatoire en général','professions réglementées','recommandée'], 'reglementation', 'medium', NULL),
('Mentions obligatoires sur une facture B2B en France ?', ARRAY['code_article','bofip'], ARRAY['numéro','SIREN','TVA','date','L441-9'], 'commercial', 'easy', NULL),
-- Administratif
('Délai de recours contentieux contre une décision administrative ?', ARRAY['code_article'], ARRAY['deux mois','tribunal administratif','notification'], 'administratif', 'easy', NULL),
('Procédure de demande d''autorisation d''urbanisme pour une extension de 30 m² ?', ARRAY['code_article'], ARRAY['déclaration préalable','permis de construire','40 m²','20 m²'], 'administratif', 'medium', NULL),
-- Convention collective spécifique
('Durée minimale du préavis de démission cadre Syntec ?', ARRAY['convention_collective','convention_article'], ARRAY['trois mois','Syntec','cadre','article 15'], 'rupture', 'medium', '1486');