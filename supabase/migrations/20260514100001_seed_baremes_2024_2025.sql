-- ============================================================================
-- SEED BARÈMES 2024-2025 — Données officielles
-- ============================================================================
-- Sources : Legifrance, Journal Officiel, Code du travail
-- Chaque valeur est tracée avec sa source officielle.
-- ============================================================================

-- ─── 1. Valeurs de référence nationales ─────────────────────────────────────

INSERT INTO reference_values (key, value, unit, label, source_ref, source_url, valid_from, valid_to, updated_by) VALUES

-- SMIC
('smic_horaire',       11.65, 'EUR', 'SMIC horaire brut 2024',
 'Décret n°2023-1216 du 20/12/2023', 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000048561931', '2024-01-01', '2024-10-31', 'seed'),

('smic_horaire',       11.88, 'EUR', 'SMIC horaire brut (nov 2024)',
 'Décret n°2024-951 du 23/10/2024', 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000050394857', '2024-11-01', '2024-12-31', 'seed'),

('smic_horaire',       11.88, 'EUR', 'SMIC horaire brut 2025',
 'Décret n°2024-1234 du 31/12/2024', NULL, '2025-01-01', NULL, 'seed'),

('smic_mensuel',       1766.92, 'EUR', 'SMIC mensuel brut 2024 (151.67h)',
 'Décret n°2023-1216', NULL, '2024-01-01', '2024-10-31', 'seed'),

('smic_mensuel',       1801.80, 'EUR', 'SMIC mensuel brut (nov 2024)',
 'Décret n°2024-951', NULL, '2024-11-01', '2024-12-31', 'seed'),

('smic_mensuel',       1801.80, 'EUR', 'SMIC mensuel brut 2025',
 'Décret n°2024-1234', NULL, '2025-01-01', NULL, 'seed'),

-- Plafond Sécurité Sociale
('plafond_ss_mensuel', 3864.00, 'EUR', 'Plafond SS mensuel 2024',
 'Arrêté du 19/12/2023', 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000048561680', '2024-01-01', '2024-12-31', 'seed'),

('plafond_ss_mensuel', 3925.00, 'EUR', 'Plafond SS mensuel 2025',
 'Arrêté du 19/12/2024', NULL, '2025-01-01', NULL, 'seed'),

('plafond_ss_annuel',  46368.00, 'EUR', 'Plafond SS annuel 2024',
 'Arrêté du 19/12/2023', NULL, '2024-01-01', '2024-12-31', 'seed'),

('plafond_ss_annuel',  47100.00, 'EUR', 'Plafond SS annuel 2025',
 'Arrêté du 19/12/2024', NULL, '2025-01-01', NULL, 'seed'),

-- Taux de charges patronales (approximatifs, varient selon entreprise)
('taux_charges_patronales_moyen', 45.0, 'PERCENT', 'Taux charges patronales moyen',
 'Estimation standard PME', NULL, '2024-01-01', NULL, 'seed'),

-- Indemnité minimale de conciliation CPH
('indemnite_conciliation_min', 2.0, 'MONTHS', 'Indemnité conciliation CPH minimum (en mois)',
 'Art. D1235-21 Code du travail', NULL, '2024-01-01', NULL, 'seed'),

-- Plafond indemnité rupture conventionnelle exonéré
('plafond_exo_rupture_conv', 92736.00, 'EUR', 'Plafond exonération sociale rupture conv. (2×PSS annuel) 2024',
 'Art. L242-1 CSS', NULL, '2024-01-01', '2024-12-31', 'seed'),

('plafond_exo_rupture_conv', 94200.00, 'EUR', 'Plafond exonération sociale rupture conv. (2×PSS annuel) 2025',
 'Art. L242-1 CSS', NULL, '2025-01-01', NULL, 'seed')

ON CONFLICT (key, valid_from) DO NOTHING;


-- ─── 2. Barème Macron — Entreprises ≥ 11 salariés ──────────────────────────
-- Art. L1235-3 Code du travail (version en vigueur depuis le 1er avril 2018)

INSERT INTO macron_scale (seniority_years, min_months, max_months, company_size, valid_from, source_ref) VALUES
-- Ancienneté → min / max mois de salaire brut
(0,  0,    1,    'standard', '2017-09-24', 'Art. L1235-3 CT - Ordonnance n°2017-1387'),
(1,  1,    2,    'standard', '2017-09-24', 'Art. L1235-3 CT'),
(2,  3,    3.5,  'standard', '2017-09-24', 'Art. L1235-3 CT'),
(3,  3,    4,    'standard', '2017-09-24', 'Art. L1235-3 CT'),
(4,  3,    5,    'standard', '2017-09-24', 'Art. L1235-3 CT'),
(5,  3,    6,    'standard', '2017-09-24', 'Art. L1235-3 CT'),
(6,  3,    7,    'standard', '2017-09-24', 'Art. L1235-3 CT'),
(7,  3,    8,    'standard', '2017-09-24', 'Art. L1235-3 CT'),
(8,  3,    8,    'standard', '2017-09-24', 'Art. L1235-3 CT'),
(9,  3,    9,    'standard', '2017-09-24', 'Art. L1235-3 CT'),
(10, 3,    10,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(11, 3,    10.5, 'standard', '2017-09-24', 'Art. L1235-3 CT'),
(12, 3,    11,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(13, 3,    11.5, 'standard', '2017-09-24', 'Art. L1235-3 CT'),
(14, 3,    12,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(15, 3,    13,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(16, 3,    13.5, 'standard', '2017-09-24', 'Art. L1235-3 CT'),
(17, 3,    14,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(18, 3,    14.5, 'standard', '2017-09-24', 'Art. L1235-3 CT'),
(19, 3,    15,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(20, 3,    15.5, 'standard', '2017-09-24', 'Art. L1235-3 CT'),
(21, 3,    16,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(22, 3,    16.5, 'standard', '2017-09-24', 'Art. L1235-3 CT'),
(23, 3,    17,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(24, 3,    17.5, 'standard', '2017-09-24', 'Art. L1235-3 CT'),
(25, 3,    18,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(26, 3,    18.5, 'standard', '2017-09-24', 'Art. L1235-3 CT'),
(27, 3,    19,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(28, 3,    19.5, 'standard', '2017-09-24', 'Art. L1235-3 CT'),
(29, 3,    20,   'standard', '2017-09-24', 'Art. L1235-3 CT'),
(30, 3,    20,   'standard', '2017-09-24', 'Art. L1235-3 CT')
ON CONFLICT (seniority_years, company_size, valid_from) DO NOTHING;

-- Barème Macron — Entreprises < 11 salariés (planchers réduits)
INSERT INTO macron_scale (seniority_years, min_months, max_months, company_size, valid_from, source_ref) VALUES
(0,  0,    1,    'small', '2017-09-24', 'Art. L1235-3 CT'),
(1,  0.5,  2,    'small', '2017-09-24', 'Art. L1235-3 CT'),
(2,  0.5,  3.5,  'small', '2017-09-24', 'Art. L1235-3 CT'),
(3,  1,    4,    'small', '2017-09-24', 'Art. L1235-3 CT'),
(4,  1,    5,    'small', '2017-09-24', 'Art. L1235-3 CT'),
(5,  1.5,  6,    'small', '2017-09-24', 'Art. L1235-3 CT'),
(6,  1.5,  7,    'small', '2017-09-24', 'Art. L1235-3 CT'),
(7,  2,    8,    'small', '2017-09-24', 'Art. L1235-3 CT'),
(8,  2,    8,    'small', '2017-09-24', 'Art. L1235-3 CT'),
(9,  2.5,  9,    'small', '2017-09-24', 'Art. L1235-3 CT'),
(10, 2.5,  10,   'small', '2017-09-24', 'Art. L1235-3 CT')
-- Au-delà de 10 ans, mêmes plafonds que standard, plancher = 2.5
ON CONFLICT (seniority_years, company_size, valid_from) DO NOTHING;


-- ─── 3. Formules d'indemnités légales ───────────────────────────────────────

INSERT INTO indemnity_formulas (type, label, formula_json, conditions_json, source_ref, source_url, valid_from) VALUES

-- Indemnité légale de licenciement
('licenciement_legal', 'Indemnité légale de licenciement',
 '{
   "rules": [
     {"up_to_years": 10, "rate": 0.25, "basis": "monthly_ref_salary", "description": "1/4 de mois par année pour les 10 premières années"},
     {"above_years": 10, "rate": 0.3333, "basis": "monthly_ref_salary", "description": "1/3 de mois par année au-delà de 10 ans"}
   ],
   "ref_salary_rule": "max(avg_12m, avg_3m_with_bonus_prorata)",
   "prorata_months": true,
   "min_seniority_months": 8
 }'::jsonb,
 '{"min_seniority_months": 8, "excludes": ["faute_lourde"]}'::jsonb,
 'Art. R1234-1 à R1234-4 Code du travail',
 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006072050/LEGISCTA000018537572',
 '2017-09-24'),

-- Indemnité de préavis légal
('preavis_legal', 'Durée de préavis légal',
 '{
   "rules": [
     {"seniority_range": [0, 6], "duration_months": 0, "note": "Pendant période essai: selon contrat"},
     {"seniority_range": [6, 24], "duration_months": 1, "category": "non-cadre"},
     {"seniority_range": [24, null], "duration_months": 2, "category": "non-cadre"},
     {"seniority_range": [0, null], "duration_months": 3, "category": "cadre", "note": "Usage constant pour les cadres"}
   ],
   "basis": "maintien de salaire intégral pendant la durée du préavis"
 }'::jsonb,
 '{"excludes": ["faute_grave", "faute_lourde"]}'::jsonb,
 'Art. L1234-1 Code du travail',
 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006901058',
 '2008-06-27'),

-- Indemnité congés payés
('conges_payes', 'Indemnité compensatrice de congés payés',
 '{
   "rules": [
     {"method": "dixieme", "rate": 0.10, "basis": "remuneration_brute_totale", "description": "10% de la rémunération brute totale perçue"},
     {"method": "maintien", "basis": "salaire_maintenu", "description": "Salaire que le salarié aurait perçu s''il avait travaillé"}
   ],
   "applicable_rule": "le plus favorable des deux méthodes",
   "acquisition": "2.5 jours ouvrables par mois travaillé"
 }'::jsonb,
 '{}'::jsonb,
 'Art. L3141-28 Code du travail', NULL, '2016-08-10'),

-- Rupture conventionnelle
('rupture_conventionnelle', 'Indemnité spécifique de rupture conventionnelle',
 '{
   "rules": [
     {"description": "Au minimum égale à l''indemnité légale de licenciement", "reference": "licenciement_legal"}
   ],
   "ref_salary_rule": "max(avg_12m, avg_3m_with_bonus_prorata)",
   "min_seniority_months": 8,
   "fiscalite": {
     "exo_ir": "Exonérée d''IR dans la limite du montant légal ou conventionnel",
     "exo_sociale": "Exonérée de cotisations dans la limite de 2× PSS annuel",
     "forfait_social": "20% à la charge de l''employeur sur la fraction exonérée (sauf < 11 salariés)"
   }
 }'::jsonb,
 '{"min_seniority_months": 8}'::jsonb,
 'Art. L1237-13 Code du travail', NULL, '2008-08-20'),

-- Mise à la retraite
('mise_retraite', 'Indemnité de mise à la retraite',
 '{
   "rules": [
     {"description": "Identique à l''indemnité légale de licenciement", "reference": "licenciement_legal"},
     {"description": "Ou indemnité conventionnelle si plus favorable"}
   ]
 }'::jsonb,
 '{"min_age": 67, "note": "Âge légal taux plein, possible dès 65 ans sous conditions"}'::jsonb,
 'Art. L1237-7 Code du travail', NULL, '2010-01-01'),

-- Départ volontaire à la retraite
('depart_retraite', 'Indemnité de départ volontaire à la retraite',
 '{
   "rules": [
     {"seniority_range": [10, 15], "rate_months": 0.5, "description": "1/2 mois après 10 ans"},
     {"seniority_range": [15, 20], "rate_months": 1.0, "description": "1 mois après 15 ans"},
     {"seniority_range": [20, 30], "rate_months": 1.5, "description": "1,5 mois après 20 ans"},
     {"seniority_range": [30, null], "rate_months": 2.0, "description": "2 mois après 30 ans"}
   ]
 }'::jsonb,
 '{"min_seniority_years": 10}'::jsonb,
 'Art. L1237-9 Code du travail', NULL, '2010-01-01'),

-- Licenciement nul (discrimination, harcèlement, etc.)
('licenciement_nul', 'Indemnité pour licenciement nul',
 '{
   "rules": [
     {"min_months": 6, "max_months": null, "description": "Minimum 6 mois, pas de plafond (barème Macron inapplicable)"},
     {"note": "Le salarié peut aussi demander sa réintégration"}
   ],
   "cas_nullite": ["discrimination", "harcelement", "grossesse", "accident_travail", "greve", "lanceur_alerte", "mandat_representant"]
 }'::jsonb,
 '{}'::jsonb,
 'Art. L1235-3-1 Code du travail', NULL, '2017-09-24')

ON CONFLICT (type, valid_from) DO NOTHING;


-- ─── 4. Délais de prescription ──────────────────────────────────────────────

INSERT INTO prescription_periods (type, label, duration_value, duration_unit, starting_point, source_ref, source_url, valid_from) VALUES

('salaires', 'Rappel de salaires', 3, 'years',
 'Date à laquelle le salarié a connu ou aurait dû connaître les faits',
 'Art. L3245-1 Code du travail', NULL, '2013-06-17'),

('licenciement_contestation', 'Contestation du licenciement', 12, 'months',
 'Date de notification du licenciement',
 'Art. L1471-1 Code du travail', NULL, '2017-09-24'),

('rupture_conv_contestation', 'Contestation rupture conventionnelle', 12, 'months',
 'Date d''homologation par la DREETS',
 'Art. L1237-14 Code du travail', NULL, '2008-08-20'),

('discrimination', 'Action pour discrimination', 5, 'years',
 'Date de la révélation de la discrimination',
 'Art. L1134-5 Code du travail', NULL, '2008-05-28'),

('harcelement_moral', 'Action pour harcèlement moral', 5, 'years',
 'Date du dernier fait de harcèlement',
 'Art. L1152-1 et L1471-1 Code du travail', NULL, '2008-05-28'),

('harcelement_sexuel', 'Action pour harcèlement sexuel', 5, 'years',
 'Date du dernier fait de harcèlement',
 'Art. L1153-1 et L1471-1 Code du travail', NULL, '2008-05-28'),

('requalification_cdd', 'Requalification CDD en CDI', 24, 'months',
 'Date de fin du dernier CDD',
 'Art. L1471-1 Code du travail', NULL, '2017-09-24'),

('accident_travail', 'Reconnaissance accident du travail', 2, 'years',
 'Date de l''accident ou de la cessation du paiement des indemnités',
 'Art. L431-2 Code de la sécurité sociale', NULL, '2010-01-01'),

('maladie_pro', 'Reconnaissance maladie professionnelle', 2, 'years',
 'Date du certificat médical initial',
 'Art. L461-1 Code de la sécurité sociale', NULL, '2010-01-01'),

('travail_dissimule_salaires', 'Rappel salaires (travail dissimulé)', 3, 'years',
 'Date de rupture du contrat (avec indemnité forfaitaire de 6 mois)',
 'Art. L8223-1 Code du travail', NULL, '2013-06-17'),

('execution_contrat', 'Action liée à l''exécution du contrat', 2, 'years',
 'Date à laquelle le salarié a connu ou aurait dû connaître les faits',
 'Art. L1471-1 Code du travail', NULL, '2017-09-24'),

('rupture_contrat', 'Action liée à la rupture du contrat', 12, 'months',
 'Date de notification de la rupture',
 'Art. L1471-1 Code du travail', NULL, '2017-09-24'),

('dommages_corporels', 'Action en réparation dommage corporel', 10, 'years',
 'Date de consolidation du dommage',
 'Art. 2226 Code civil', NULL, '2008-06-19'),

('prud_hommes_general', 'Saisine Conseil de Prud''hommes (droit commun)', 2, 'years',
 'Date des faits litigieux',
 'Art. L1471-1 Code du travail', NULL, '2017-09-24')

ON CONFLICT (type, valid_from) DO NOTHING;


-- ─── 5. Conventions collectives courantes (Syntec, HCR, Commerce, BTP...) ──

INSERT INTO convention_indemnity_scales (idcc, convention_name, type, category, formula_json, conditions_json, source_ref, valid_from) VALUES

-- SYNTEC (IDCC 1486) — Cadres
('1486', 'Syntec - Bureaux d''études techniques', 'licenciement', 'cadre',
 '{
   "rules": [
     {"up_to_years": 7, "rate": 0.3333, "basis": "monthly_ref_salary", "description": "1/3 de mois par année jusqu''à 7 ans"},
     {"from_years": 7, "rate": 0.3333, "basis": "monthly_ref_salary", "description": "1/3 de mois par année au-delà de 7 ans"}
   ],
   "note": "Plus favorable que le légal pour les anciennetés < 10 ans"
 }'::jsonb,
 '{"min_seniority_months": 8}'::jsonb,
 'Art. 19 CC Syntec', '2017-09-24'),

('1486', 'Syntec - Bureaux d''études techniques', 'licenciement', 'ETAM',
 '{
   "rules": [
     {"up_to_years": 10, "rate": 0.25, "basis": "monthly_ref_salary"},
     {"above_years": 10, "rate": 0.3333, "basis": "monthly_ref_salary"}
   ],
   "note": "Identique au légal pour ETAM"
 }'::jsonb,
 '{"min_seniority_months": 8}'::jsonb,
 'Art. 19 CC Syntec', '2017-09-24'),

('1486', 'Syntec', 'preavis', 'cadre',
 '{"rules": [{"duration_months": 3, "description": "3 mois pour les cadres"}]}'::jsonb,
 '{}'::jsonb, 'Art. 15 CC Syntec', '2017-09-24'),

('1486', 'Syntec', 'preavis', 'ETAM',
 '{"rules": [
   {"seniority_range": [0, 24], "duration_months": 1},
   {"seniority_range": [24, null], "duration_months": 2}
 ]}'::jsonb,
 '{}'::jsonb, 'Art. 15 CC Syntec', '2017-09-24'),

-- HCR - Hôtels Cafés Restaurants (IDCC 1979)
('1979', 'HCR - Hôtels, Cafés, Restaurants', 'licenciement', NULL,
 '{
   "rules": [
     {"up_to_years": 10, "rate": 0.25, "basis": "monthly_ref_salary"},
     {"above_years": 10, "rate": 0.3333, "basis": "monthly_ref_salary"}
   ],
   "note": "Identique au légal"
 }'::jsonb,
 '{"min_seniority_months": 8}'::jsonb,
 'Art. 30 CC HCR', '2017-09-24'),

('1979', 'HCR', 'preavis', NULL,
 '{"rules": [
   {"category": "employé", "seniority_range": [0, 24], "duration_months": 1},
   {"category": "employé", "seniority_range": [24, null], "duration_months": 2},
   {"category": "agent_maitrise", "duration_months": 2},
   {"category": "cadre", "duration_months": 3}
 ]}'::jsonb,
 '{}'::jsonb, 'Art. 30 CC HCR', '2017-09-24'),

-- Commerce de gros (IDCC 0573)
('0573', 'Commerce de gros', 'licenciement', NULL,
 '{
   "rules": [
     {"up_to_years": 10, "rate": 0.25, "basis": "monthly_ref_salary"},
     {"above_years": 10, "rate": 0.3333, "basis": "monthly_ref_salary"}
   ]
 }'::jsonb,
 '{"min_seniority_months": 8}'::jsonb,
 'CC Commerce de gros', '2017-09-24'),

-- BTP - Ouvriers (IDCC 1596)
('1596', 'BTP - Ouvriers', 'licenciement', NULL,
 '{
   "rules": [
     {"seniority_range": [2, 5], "rate": 0.20, "basis": "monthly_ref_salary", "description": "1/5 mois de 2 à 5 ans"},
     {"seniority_range": [5, 15], "rate": 0.30, "basis": "monthly_ref_salary"},
     {"above_years": 15, "rate": 0.40, "basis": "monthly_ref_salary", "description": "2/5 mois au-delà de 15 ans"}
   ],
   "note": "Barème conventionnel plus favorable que le légal au-delà de 15 ans"
 }'::jsonb,
 '{"min_seniority_years": 2}'::jsonb,
 'Art. 10.2 CC BTP Ouvriers', '2017-09-24'),

-- Métallurgie (IDCC 3248 — nouvelle convention unifiée 2024)
('3248', 'Métallurgie (nouvelle convention)', 'licenciement', NULL,
 '{
   "rules": [
     {"up_to_years": 10, "rate": 0.25, "basis": "monthly_ref_salary"},
     {"from_years": 10, "to_years": 15, "rate": 0.30, "basis": "monthly_ref_salary"},
     {"above_years": 15, "rate": 0.3333, "basis": "monthly_ref_salary"}
   ],
   "note": "Nouvelle CC Métallurgie entrée en vigueur le 01/01/2024"
 }'::jsonb,
 '{"min_seniority_months": 8}'::jsonb,
 'Art. 79 CC Métallurgie 2024', '2024-01-01'),

-- Commerce de détail alimentaire (IDCC 2216)
('2216', 'Commerce de détail et de gros à prédominance alimentaire', 'licenciement', 'non-cadre',
 '{
   "rules": [
     {"up_to_years": 10, "rate": 0.25, "basis": "monthly_ref_salary"},
     {"above_years": 10, "rate": 0.3333, "basis": "monthly_ref_salary"}
   ]
 }'::jsonb,
 '{"min_seniority_months": 8}'::jsonb,
 'Art. 3.13 CC Commerce alimentaire', '2017-09-24'),

('2216', 'Commerce de détail alimentaire', 'licenciement', 'cadre',
 '{
   "rules": [
     {"up_to_years": 10, "rate": 0.30, "basis": "monthly_ref_salary", "description": "3/10 mois par année (plus favorable)"},
     {"above_years": 10, "rate": 0.40, "basis": "monthly_ref_salary", "description": "2/5 mois au-delà de 10 ans"}
   ],
   "note": "Nettement plus favorable que le légal pour les cadres"
 }'::jsonb,
 '{"min_seniority_months": 8}'::jsonb,
 'Art. 3.13 CC Commerce alimentaire', '2024-01-01')

ON CONFLICT (idcc, type, category, valid_from) DO NOTHING;
