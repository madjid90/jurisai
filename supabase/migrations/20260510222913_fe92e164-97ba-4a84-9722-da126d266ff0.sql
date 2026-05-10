
-- agent_memory
CREATE TABLE IF NOT EXISTS public.agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID,
  dossier_id UUID,
  scope TEXT NOT NULL DEFAULT 'tenant',
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  relevance REAL NOT NULL DEFAULT 0.5,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_tenant_scope_key ON public.agent_memory(tenant_id, scope, key);
CREATE INDEX IF NOT EXISTS idx_agent_memory_dossier ON public.agent_memory(dossier_id) WHERE dossier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_memory_user ON public.agent_memory(user_id) WHERE user_id IS NOT NULL;
ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their tenant memory" ON public.agent_memory
  FOR SELECT USING (public.is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members can insert tenant memory" ON public.agent_memory
  FOR INSERT WITH CHECK (public.is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members can update tenant memory" ON public.agent_memory
  FOR UPDATE USING (public.is_member_of_tenant(auth.uid(), tenant_id));
CREATE POLICY "Members can delete tenant memory" ON public.agent_memory
  FOR DELETE USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE TRIGGER trg_agent_memory_updated_at
  BEFORE UPDATE ON public.agent_memory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- business_rules (catalogue global, pas de tenant — règles juridiques universelles)
CREATE TABLE IF NOT EXISTS public.business_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  domain TEXT NOT NULL DEFAULT 'general',
  required_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_sla_days INT,
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_sensitive BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.business_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view business rules" ON public.business_rules
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Super admins can manage business rules" ON public.business_rules
  FOR ALL USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER trg_business_rules_updated_at
  BEFORE UPDATE ON public.business_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- agent_post_checks : journal pipeline post-réponse
CREATE TABLE IF NOT EXISTS public.agent_post_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  agent_run_id UUID,
  rule_kind TEXT,
  missing_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  requires_validation BOOLEAN NOT NULL DEFAULT false,
  validation_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ok',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_post_checks_run ON public.agent_post_checks(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_post_checks_tenant ON public.agent_post_checks(tenant_id, created_at DESC);
ALTER TABLE public.agent_post_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view tenant post checks" ON public.agent_post_checks
  FOR SELECT USING (public.is_member_of_tenant(auth.uid(), tenant_id));

-- Seed 13 règles métier
INSERT INTO public.business_rules (kind, title, subtitle, domain, required_fields, risks, steps, validation_roles, validation_sla_days, keywords, is_sensitive)
VALUES
('rupture_conventionnelle', 'Rupture conventionnelle', 'Procédure homologuée par la DREETS — quelques infos avant de préparer le dossier.', 'rh',
  '[{"key":"salarie_nom","label":"Nom complet du salarié"},{"key":"salarie_anciennete","label":"Ancienneté (années)","type":"number"},{"key":"salaire_brut","label":"Salaire mensuel brut (€)","type":"number"},{"key":"date_envisagee","label":"Date de rupture envisagée","type":"date"},{"key":"motif","label":"Motif principal","type":"textarea"}]',
  '["Indemnité spécifique ≥ indemnité légale de licenciement (sinon nullité).","Délai de rétractation de 15 jours calendaires post-signature.","Homologation DREETS sous 15 jours ouvrables — refus possible.","Risque de requalification en licenciement sans cause si vice du consentement."]',
  '["Préparer le formulaire CERFA 14598*01.","Convoquer le salarié à au moins un entretien.","Signer la convention de rupture.","Démarrer le délai de rétractation (15 jours).","Transmettre la demande d''homologation à la DREETS.","Calculer et programmer le solde de tout compte."]',
  '["rh_manager","juriste"]', 2,
  '["rupture conventionnelle","rupture\\\\s+convention"]', true),

('licenciement', 'Licenciement', 'Procédure à fort risque prud''homal — validation juriste obligatoire.', 'rh',
  '[{"key":"salarie_nom","label":"Nom complet du salarié"},{"key":"type_motif","label":"Type de motif"},{"key":"faits","label":"Faits / éléments matériels","type":"textarea"},{"key":"date_decouverte","label":"Date de découverte des faits","type":"date"}]',
  '["Prescription disciplinaire de 2 mois (art. L.1332-4 CT).","Procédure obligatoire : convocation 5 jours ouvrables, entretien préalable, notification motivée.","Risque de licenciement sans cause réelle et sérieuse → indemnité barème Macron.","Risque de nullité (discrimination, harcèlement, lanceur d''alerte) → réintégration possible."]',
  '["Vérifier la prescription (2 mois) et l''absence de discrimination.","Convoquer à l''entretien préalable.","Tenir l''entretien (≥ 5 jours ouvrables après convocation).","Notifier le licenciement (motifs précis).","Établir reçu pour solde de tout compte, certificat de travail, attestation France Travail."]',
  '["juriste","rh_manager","dirigeant"]', 3,
  '["licenci"]', true),

('sanction_disciplinaire', 'Sanction disciplinaire', 'Avertissement, mise à pied, rétrogradation… procédure encadrée.', 'rh',
  '[{"key":"salarie_nom","label":"Nom du salarié"},{"key":"niveau_sanction","label":"Niveau envisagé"},{"key":"faits","label":"Faits reprochés","type":"textarea"},{"key":"date_faits","label":"Date des faits","type":"date"}]',
  '["Prescription de 2 mois à compter de la connaissance des faits.","Au-delà de l''avertissement : entretien préalable obligatoire.","Sanction pécuniaire interdite.","Double sanction interdite pour les mêmes faits."]',
  '["Vérifier la prescription.","Si > avertissement : convoquer à un entretien préalable.","Notifier la sanction par écrit (motifs).","Inscrire au dossier disciplinaire."]',
  '["rh_manager","juriste"]', 1,
  '["sanction","avertissement","mise à pied","rétrogradation"]', true),

('embauche', 'Embauche', 'Préparer le contrat et les déclarations préalables.', 'rh',
  '[{"key":"candidat_nom","label":"Nom du candidat"},{"key":"type_contrat","label":"Type de contrat"},{"key":"poste","label":"Intitulé du poste"},{"key":"date_debut","label":"Date d''entrée prévue","type":"date"},{"key":"remuneration","label":"Rémunération brute annuelle (€)","type":"number"}]',
  '["DPAE obligatoire dans les 8 jours précédant l''embauche.","Visite d''information et de prévention (VIP) à programmer.","Période d''essai à mentionner expressément (sinon non opposable).","Vérifier la convention collective applicable (IDCC)."]',
  '["Effectuer la DPAE (URSSAF).","Rédiger et faire signer le contrat de travail.","Programmer la VIP.","Inscrire au registre unique du personnel.","Affilier aux organismes sociaux."]',
  '["rh_manager"]', 1,
  '["embauche","recrutement","cdi","cdd","dpae"]', false),

('mise_en_demeure', 'Mise en demeure', 'Acte préalable à toute action contentieuse.', 'commercial',
  '[{"key":"destinataire","label":"Destinataire","type":"textarea"},{"key":"objet","label":"Objet"},{"key":"montant","label":"Montant en jeu (€)","type":"number"},{"key":"delai","label":"Délai (jours)","type":"number"}]',
  '["Forme : LRAR ou commissaire de justice.","Doit être suffisamment précise.","Préalable obligatoire à de nombreuses actions.","Délai raisonnable obligatoire (8 à 15 jours)."]',
  '["Rédiger la mise en demeure.","Envoyer par LRAR.","Archiver l''AR.","Programmer le suivi à expiration."]',
  '["juriste"]', 1,
  '["mise en demeure"]', true),

('rupture_contrat_commercial', 'Rupture de contrat commercial', 'Attention au préavis et à la rupture brutale (art. L.442-1 C. com.).', 'commercial',
  '[{"key":"partenaire","label":"Partenaire commercial"},{"key":"anciennete_relation","label":"Ancienneté (années)","type":"number"},{"key":"ca_annuel","label":"CA annuel (€)","type":"number"},{"key":"motif","label":"Motif","type":"textarea"}]',
  '["Rupture brutale sanctionnée si préavis insuffisant.","Préavis indicatif : ~1 mois par année de relation.","Risque d''indemnisation = marge brute perdue.","Notification écrite obligatoire (LRAR)."]',
  '["Évaluer le préavis raisonnable.","Notifier la rupture par LRAR.","Maintenir les conditions habituelles.","Documenter les motifs."]',
  '["juriste","dirigeant"]', 3,
  '["rupture commercial","fin partenariat","résiliation contrat"]', true),

('transaction', 'Transaction', 'Accord transactionnel — concessions réciproques, irrévocable une fois signé.', 'contentieux',
  '[{"key":"partie_adverse","label":"Partie adverse"},{"key":"objet_litige","label":"Objet du litige","type":"textarea"},{"key":"montant_propose","label":"Montant proposé (€)","type":"number"},{"key":"concessions","label":"Concessions réciproques","type":"textarea"}]',
  '["Doit comporter des concessions réciproques (sinon nullité).","Autorité de la chose jugée (art. 2052 C. civ.).","Irrévocable sauf vice du consentement.","Rédaction écrite indispensable."]',
  '["Identifier le litige.","Formaliser les concessions.","Rédiger le protocole.","Faire signer chaque page.","Archiver l''original."]',
  '["juriste","dirigeant"]', 5,
  '["transaction","protocole transactionnel"]', true),

('contentieux', 'Ouverture de contentieux', 'Validation dirigeant requise.', 'contentieux',
  '[{"key":"partie_adverse","label":"Partie adverse"},{"key":"juridiction","label":"Juridiction"},{"key":"objet","label":"Objet de la demande","type":"textarea"},{"key":"enjeu","label":"Enjeu (€)","type":"number"}]',
  '["Frais d''avocat, huissier, expertise non récupérables.","Délai 12 à 36 mois.","Risque réputationnel.","Article 700 / dépens en cas de perte."]',
  '["Vérifier la prescription.","Tenter une résolution amiable.","Choisir l''avocat.","Préparer assignation.","Signifier et enrôler."]',
  '["juriste","dirigeant"]', 5,
  '["contentieux","assignation","prudhommes","tribunal"]', true),

('depot_legal', 'Dépôt légal / formalité société', 'Greffe du tribunal de commerce — délais stricts.', 'societes',
  '[{"key":"type_formalite","label":"Type de formalité"},{"key":"date_evenement","label":"Date","type":"date"}]',
  '["Comptes annuels : dépôt sous 1 mois après AGO.","Modifications statutaires : 1 mois après l''AG.","Sanctions pénales possibles.","Injonction sous astreinte."]',
  '["Préparer le dossier.","Déposer sur le guichet unique INPI.","Régler les frais de greffe.","Conserver le récépissé."]',
  '["juriste","daf"]', 2,
  '["comptes annuels","dépôt greffe","formalité"]', true),

('modification_statuts', 'Modification des statuts', 'Formalisme corporate strict.', 'societes',
  '[{"key":"objet_modification","label":"Objet","type":"textarea"},{"key":"date_ag","label":"Date d''AG","type":"date"}]',
  '["Quorum/majorité variables.","Publicité au JAL obligatoire.","Dépôt au greffe sous 1 mois.","Inopposabilité aux tiers tant que non publiée."]',
  '["Convoquer l''AG.","Tenir l''AG, rédiger PV.","Mettre à jour les statuts.","Publier au JAL.","Déposer au guichet INPI."]',
  '["juriste","dirigeant"]', 3,
  '["modification statuts","changement gérant","transfert siège"]', true),

('rgpd_violation', 'Violation de données personnelles', 'Notification CNIL sous 72h si risque.', 'rgpd',
  '[{"key":"nature","label":"Nature","type":"textarea"},{"key":"date_decouverte","label":"Date","type":"date"},{"key":"personnes_concernees","label":"Personnes concernées","type":"number"},{"key":"donnees_concernees","label":"Catégories","type":"textarea"}]',
  '["Notification CNIL : 72h (art. 33 RGPD).","Information des personnes si risque élevé (art. 34).","Sanctions jusqu''à 20 M€ ou 4 % du CA.","Inscription au registre des violations."]',
  '["Qualifier la violation.","Évaluer le risque.","Notifier la CNIL.","Informer les personnes si nécessaire.","Inscrire au registre.","Mesures correctives."]',
  '["dpo","juriste","dirigeant"]', 1,
  '["violation données","fuite données","incident rgpd","data breach"]', true),

('redressement_fiscal', 'Redressement / contrôle fiscal', 'Procédure contradictoire — délais impératifs.', 'fiscal',
  '[{"key":"type_controle","label":"Type"},{"key":"date_proposition","label":"Date proposition","type":"date"},{"key":"montant_redressement","label":"Montant (€)","type":"number"}]',
  '["Délai de réponse 30 jours.","Acquiescement implicite si pas de réponse.","Pénalités jusqu''à 80 %.","Recours hiérarchique puis contentieux."]',
  '["Analyser la proposition.","Solliciter prorogation si besoin.","Préparer la réponse motivée.","Recours hiérarchique.","Saisir la commission ou le juge."]',
  '["daf","juriste","dirigeant"]', 2,
  '["redressement","contrôle fiscal","proposition de rectification"]', true),

('generic', 'Action juridique', 'Quelques précisions avant de continuer.', 'general',
  '[]', '[]', '[]', '["juriste"]', 2, '[]', false)
ON CONFLICT (kind) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  domain = EXCLUDED.domain,
  required_fields = EXCLUDED.required_fields,
  risks = EXCLUDED.risks,
  steps = EXCLUDED.steps,
  validation_roles = EXCLUDED.validation_roles,
  validation_sla_days = EXCLUDED.validation_sla_days,
  keywords = EXCLUDED.keywords,
  is_sensitive = EXCLUDED.is_sensitive,
  updated_at = now();
