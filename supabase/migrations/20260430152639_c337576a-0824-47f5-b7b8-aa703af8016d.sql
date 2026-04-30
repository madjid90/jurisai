CREATE UNIQUE INDEX IF NOT EXISTS workflow_definitions_slug_unique ON public.workflow_definitions(slug);

INSERT INTO public.workflow_definitions (tenant_id, slug, title, description, category, status, version, steps, legal_refs, estimated_duration_days)
VALUES
(NULL, 'rh-licenciement-faute-simple', 'Licenciement pour faute simple', 'Procédure complète : convocation, entretien, notification, solde de tout compte.', 'social', 'validated', 1,
 '[
   {"key":"qualification","title":"Qualifier les faits","type":"decision","required_data":["faits_constates","date_decouverte"],"legal_refs":["Article L1232-1 Code du travail"],"risks":[{"title":"Faits non constitutifs d''une faute","severity":"high"}]},
   {"key":"convocation","title":"Convocation à entretien préalable","type":"document","documents_to_generate":["lettre-convocation-entretien-prealable"],"required_data":["nom_salarie","adresse_salarie","date_entretien","lieu_entretien"],"legal_refs":["Article L1232-2"],"reminder_days":5},
   {"key":"entretien","title":"Tenir l''entretien préalable","type":"action","delay_days":5,"legal_refs":["Article L1232-3"]},
   {"key":"reflexion","title":"Délai de réflexion (2 jours ouvrables)","type":"wait","delay_days":2,"legal_refs":["Article L1232-6"]},
   {"key":"notification","title":"Notification du licenciement","type":"document","documents_to_generate":["lettre-licenciement-faute-simple"],"required_data":["motif_precis","date_notification"],"validation_required":true,"risks":[{"title":"Motif insuffisamment précis","severity":"critical"}]},
   {"key":"solde","title":"Établir le solde de tout compte","type":"document","documents_to_generate":["solde-tout-compte"],"required_data":["dernier_salaire","conges_restants"]}
 ]'::jsonb, '["L1232-1 à L1232-6 Code du travail"]'::jsonb, 14),

(NULL, 'rh-rupture-conventionnelle', 'Rupture conventionnelle', 'Procédure homologuée DREETS.', 'social', 'validated', 1,
 '[
   {"key":"entretien","title":"Entretien(s) de négociation","type":"action","required_data":["date_entretien"]},
   {"key":"convention","title":"Signer la convention","type":"document","documents_to_generate":["convention-rupture-conventionnelle"],"required_data":["indemnite_rupture","date_rupture_envisagee"],"validation_required":true},
   {"key":"retractation","title":"Délai de rétractation (15 jours)","type":"wait","delay_days":15,"legal_refs":["Article L1237-13"]},
   {"key":"homologation","title":"Demande d''homologation DREETS","type":"action","delay_days":15,"reminder_days":15}
 ]'::jsonb, '["L1237-11 à L1237-16"]'::jsonb, 35),

(NULL, 'rh-arret-maladie', 'Gestion d''un arrêt maladie', 'Suivi des justificatifs et obligations employeur.', 'social', 'validated', 1,
 '[
   {"key":"reception","title":"Réception du justificatif","type":"action","required_data":["date_debut","date_fin","nom_salarie"],"reminder_days":2},
   {"key":"declaration","title":"Déclaration DSN","type":"action","delay_days":5},
   {"key":"suivi","title":"Suivi des prolongations","type":"wait"},
   {"key":"reprise","title":"Visite de reprise (si > 60 jours)","type":"action","reminder_days":7}
 ]'::jsonb, '["L1226-1 et suivants"]'::jsonb, 30),

(NULL, 'commercial-relance-impayes', 'Relance et recouvrement d''impayés', 'Relance amiable → mise en demeure → contentieux.', 'commercial', 'validated', 1,
 '[
   {"key":"relance1","title":"1ère relance amiable","type":"document","documents_to_generate":["relance-amiable-1"],"required_data":["nom_client","montant_du","numero_facture","date_facture"],"reminder_days":15},
   {"key":"relance2","title":"2ème relance avec préavis","type":"document","documents_to_generate":["relance-amiable-2"],"reminder_days":15},
   {"key":"mise_en_demeure","title":"Mise en demeure RAR","type":"document","documents_to_generate":["mise-en-demeure-paiement"],"required_data":["delai_paiement"],"validation_required":true,"legal_refs":["Article 1344 Code civil"],"risks":[{"title":"Prescription 5 ans","severity":"high"}]},
   {"key":"contentieux","title":"Décision contentieuse","type":"decision","required_data":["choix_procedure"]}
 ]'::jsonb, '["Article L441-10 Code de commerce","Article 1344 Code civil"]'::jsonb, 45),

(NULL, 'commercial-rupture-relations', 'Rupture brutale de relations commerciales établies', 'Vérification du préavis et risques L442-1.', 'commercial', 'validated', 1,
 '[
   {"key":"analyse","title":"Analyser la durée et l''intensité de la relation","type":"decision","required_data":["duree_relation_annees","ca_concerne"],"legal_refs":["L442-1 II Code de commerce"],"risks":[{"title":"Préavis insuffisant","severity":"critical"}]},
   {"key":"calcul_preavis","title":"Calculer le préavis raisonnable","type":"action","required_data":["preavis_propose_mois"]},
   {"key":"notification","title":"Notification écrite","type":"document","documents_to_generate":["lettre-rupture-relations-commerciales"],"validation_required":true},
   {"key":"execution","title":"Exécution du préavis","type":"wait"}
 ]'::jsonb, '["Article L442-1 II Code de commerce"]'::jsonb, 90),

(NULL, 'commercial-verification-cgv', 'Audit et mise à jour CGV', 'Vérification de conformité commerciale et conso.', 'commercial', 'validated', 1,
 '[
   {"key":"audit","title":"Audit clauses existantes","type":"action","required_data":["cgv_actuelles"]},
   {"key":"correctifs","title":"Identifier les clauses à corriger","type":"decision","risks":[{"title":"Clauses abusives","severity":"high"}]},
   {"key":"redaction","title":"Rédiger la nouvelle version","type":"document","documents_to_generate":["cgv-b2b-standard"],"validation_required":true},
   {"key":"diffusion","title":"Mise en ligne / acceptation clients","type":"action"}
 ]'::jsonb, '["Articles L441-1 et suivants Code de commerce"]'::jsonb, 21),

(NULL, 'societes-pv-ag-ordinaire', 'PV d''Assemblée Générale Ordinaire', 'Approbation des comptes annuels.', 'societes', 'validated', 1,
 '[
   {"key":"convocation","title":"Convocation des associés","type":"document","documents_to_generate":["convocation-ag-ordinaire"],"required_data":["date_ag","ordre_du_jour"],"delay_days":15,"legal_refs":["Article L223-27 Code de commerce (SARL)"]},
   {"key":"tenue","title":"Tenue de l''AG","type":"action"},
   {"key":"pv","title":"Rédaction du PV","type":"document","documents_to_generate":["pv-ag-ordinaire-approbation-comptes"],"required_data":["resultat_exercice","affectation"],"validation_required":true},
   {"key":"depot","title":"Dépôt des comptes au greffe","type":"action","reminder_days":30,"legal_refs":["Article L232-23"]}
 ]'::jsonb, '["L223-27","L232-21 à L232-23"]'::jsonb, 60),

(NULL, 'societes-cession-parts', 'Cession de parts sociales SARL', 'Agrément, acte, formalités.', 'societes', 'validated', 1,
 '[
   {"key":"agrement","title":"Obtenir l''agrément des associés","type":"decision","required_data":["nb_parts_cedees","cessionnaire","prix"],"legal_refs":["Article L223-14"],"risks":[{"title":"Défaut d''agrément","severity":"critical"}]},
   {"key":"acte","title":"Rédiger l''acte de cession","type":"document","documents_to_generate":["acte-cession-parts-sarl"],"validation_required":true},
   {"key":"signification","title":"Signification à la société","type":"action","legal_refs":["Article 1690 Code civil"]},
   {"key":"enregistrement","title":"Enregistrement fiscal (1 mois)","type":"action","delay_days":30,"reminder_days":30}
 ]'::jsonb, '["L223-14 à L223-16","Article 1690 Code civil"]'::jsonb, 45),

(NULL, 'rgpd-demande-acces', 'Traitement d''une demande d''accès (Art. 15)', 'Réponse dans le délai d''un mois.', 'rgpd', 'validated', 1,
 '[
   {"key":"verification","title":"Vérifier l''identité du demandeur","type":"action","required_data":["identite_verifiee"],"reminder_days":3},
   {"key":"recensement","title":"Recenser les données traitées","type":"action","required_data":["liste_traitements"]},
   {"key":"reponse","title":"Préparer la réponse","type":"document","documents_to_generate":["reponse-demande-acces-rgpd"],"validation_required":true,"legal_refs":["RGPD Art. 15"]},
   {"key":"envoi","title":"Envoi sous 1 mois","type":"action","delay_days":30,"reminder_days":25,"risks":[{"title":"Dépassement du délai → sanction CNIL","severity":"high"}]}
 ]'::jsonb, '["RGPD Article 15","Loi 78-17 modifiée"]'::jsonb, 30),

(NULL, 'rgpd-registre-traitements', 'Création du registre des traitements', 'Article 30 RGPD — obligatoire.', 'rgpd', 'validated', 1,
 '[
   {"key":"inventaire","title":"Inventaire des traitements","type":"action","required_data":["liste_traitements"]},
   {"key":"qualification","title":"Qualifier finalité, base légale, données","type":"decision","risks":[{"title":"Base légale absente","severity":"high"}]},
   {"key":"redaction","title":"Rédiger le registre","type":"document","documents_to_generate":["registre-traitements-simplifie"],"validation_required":true,"legal_refs":["RGPD Art. 30"]},
   {"key":"diffusion","title":"Mise à disposition interne et CNIL si demande","type":"action"}
 ]'::jsonb, '["RGPD Article 30"]'::jsonb, 21),

(NULL, 'rgpd-violation-donnees', 'Notification d''une violation de données', 'Notification CNIL sous 72h.', 'rgpd', 'validated', 1,
 '[
   {"key":"detection","title":"Documenter la violation","type":"action","required_data":["nature_violation","date_decouverte","personnes_concernees"],"reminder_days":1,"risks":[{"title":"Délai 72h dépassé","severity":"critical"}]},
   {"key":"evaluation","title":"Évaluer le risque pour les personnes","type":"decision","required_data":["niveau_risque"]},
   {"key":"notification_cnil","title":"Notifier la CNIL","type":"document","documents_to_generate":["notification-cnil-violation"],"validation_required":true,"legal_refs":["RGPD Art. 33"],"delay_days":3},
   {"key":"information_personnes","title":"Informer les personnes (si risque élevé)","type":"document","legal_refs":["RGPD Art. 34"]}
 ]'::jsonb, '["RGPD Articles 33 et 34"]'::jsonb, 3)

ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  steps = EXCLUDED.steps,
  legal_refs = EXCLUDED.legal_refs,
  estimated_duration_days = EXCLUDED.estimated_duration_days,
  status = EXCLUDED.status,
  updated_at = now();