-- ─── document_templates ────────────────────────────────────────────────────
CREATE TABLE public.document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'autre',
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  icon TEXT DEFAULT 'FileText',
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated views public templates"
  ON public.document_templates FOR SELECT TO authenticated
  USING (is_public = true);

CREATE POLICY "Members view tenant templates"
  ON public.document_templates FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Admins/managers create templates"
  ON public.document_templates FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    AND (public.has_role(auth.uid(), 'admin'::app_role, tenant_id)
         OR public.has_role(auth.uid(), 'manager'::app_role, tenant_id))
  );

CREATE POLICY "Admins/managers update tenant templates"
  ON public.document_templates FOR UPDATE TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND (public.has_role(auth.uid(), 'admin'::app_role, tenant_id)
         OR public.has_role(auth.uid(), 'manager'::app_role, tenant_id))
  );

CREATE POLICY "Admins delete tenant templates"
  ON public.document_templates FOR DELETE TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND public.has_role(auth.uid(), 'admin'::app_role, tenant_id)
  );

CREATE TRIGGER set_document_templates_updated_at
  BEFORE UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_document_templates_tenant ON public.document_templates(tenant_id);
CREATE INDEX idx_document_templates_public ON public.document_templates(is_public) WHERE is_public = true;

-- ─── documents ─────────────────────────────────────────────────────────────
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  template_id UUID REFERENCES public.document_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Document sans titre',
  content TEXT NOT NULL DEFAULT '',
  variables JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view tenant documents"
  ON public.documents FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Members create documents in their tenant"
  ON public.documents FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_member_of_tenant(auth.uid(), tenant_id)
  );

CREATE POLICY "Users update own documents"
  ON public.documents FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own documents"
  ON public.documents FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER set_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_documents_tenant ON public.documents(tenant_id);
CREATE INDEX idx_documents_user ON public.documents(user_id);

-- ─── Seed templates publics ────────────────────────────────────────────────
INSERT INTO public.document_templates (name, description, category, icon, is_public, body, variables) VALUES

('Lettre d''avertissement', 'Notification écrite à un salarié pour un manquement professionnel.', 'courrier', 'AlertTriangle', true,
$BODY$<p><strong>{{nom_entreprise}}</strong><br/>{{adresse_entreprise}}</p>
<p style="text-align:right">{{ville_entreprise}}, le {{date_courrier}}</p>
<p><strong>{{civilite_salarie}} {{prenom_salarie}} {{nom_salarie}}</strong><br/>{{adresse_salarie}}</p>
<p><strong>Objet : Avertissement</strong><br/>Lettre recommandée avec accusé de réception</p>
<p>{{civilite_salarie}},</p>
<p>Nous avons constaté le {{date_faits}} les faits suivants : {{description_faits}}.</p>
<p>Ces agissements constituent un manquement à vos obligations professionnelles et ne peuvent être tolérés.</p>
<p>Par la présente, nous vous notifions un <strong>avertissement</strong> qui sera versé à votre dossier personnel.</p>
<p>Nous vous demandons de mettre fin sans délai à ces agissements. À défaut, nous serions contraints d''envisager une sanction plus lourde.</p>
<p>Veuillez agréer, {{civilite_salarie}}, l''expression de nos salutations distinguées.</p>
<p>{{nom_signataire}}<br/>{{fonction_signataire}}</p>$BODY$::text,
'[
  {"key":"nom_entreprise","label":"Nom de l''entreprise","type":"text"},
  {"key":"adresse_entreprise","label":"Adresse de l''entreprise","type":"text"},
  {"key":"ville_entreprise","label":"Ville","type":"text"},
  {"key":"date_courrier","label":"Date du courrier","type":"date"},
  {"key":"civilite_salarie","label":"Civilité (M./Mme)","type":"text"},
  {"key":"prenom_salarie","label":"Prénom du salarié","type":"text"},
  {"key":"nom_salarie","label":"Nom du salarié","type":"text"},
  {"key":"adresse_salarie","label":"Adresse du salarié","type":"textarea"},
  {"key":"date_faits","label":"Date des faits","type":"date"},
  {"key":"description_faits","label":"Description des faits","type":"textarea"},
  {"key":"nom_signataire","label":"Nom du signataire","type":"text"},
  {"key":"fonction_signataire","label":"Fonction du signataire","type":"text"}
]'::jsonb),

('Lettre de licenciement pour motif personnel', 'Notification de licenciement après entretien préalable.', 'courrier', 'FileWarning', true,
$BODY$<p><strong>{{nom_entreprise}}</strong><br/>{{adresse_entreprise}}</p>
<p style="text-align:right">{{ville_entreprise}}, le {{date_courrier}}</p>
<p><strong>{{civilite_salarie}} {{prenom_salarie}} {{nom_salarie}}</strong><br/>{{adresse_salarie}}</p>
<p><strong>Objet : Notification de licenciement</strong><br/>Lettre recommandée avec accusé de réception</p>
<p>{{civilite_salarie}},</p>
<p>Suite à notre entretien préalable du {{date_entretien}} auquel vous {{presence_entretien}}, nous vous notifions par la présente votre licenciement pour le motif suivant : {{motif_licenciement}}.</p>
<p>Votre préavis d''une durée de {{duree_preavis}} débutera à la date de première présentation de la présente lettre. Il prendra fin le {{date_fin_preavis}}.</p>
<p>À l''issue du préavis, vous percevrez :</p>
<ul>
<li>votre solde de tout compte ;</li>
<li>une indemnité compensatrice de congés payés ;</li>
<li>l''indemnité légale (ou conventionnelle) de licenciement, si vous y avez droit.</li>
</ul>
<p>Un certificat de travail, une attestation France Travail et un reçu pour solde de tout compte vous seront remis.</p>
<p>Veuillez agréer, {{civilite_salarie}}, l''expression de nos salutations distinguées.</p>
<p>{{nom_signataire}}<br/>{{fonction_signataire}}</p>$BODY$::text,
'[
  {"key":"nom_entreprise","label":"Nom de l''entreprise","type":"text"},
  {"key":"adresse_entreprise","label":"Adresse de l''entreprise","type":"text"},
  {"key":"ville_entreprise","label":"Ville","type":"text"},
  {"key":"date_courrier","label":"Date du courrier","type":"date"},
  {"key":"civilite_salarie","label":"Civilité","type":"text"},
  {"key":"prenom_salarie","label":"Prénom du salarié","type":"text"},
  {"key":"nom_salarie","label":"Nom du salarié","type":"text"},
  {"key":"adresse_salarie","label":"Adresse du salarié","type":"textarea"},
  {"key":"date_entretien","label":"Date de l''entretien préalable","type":"date"},
  {"key":"presence_entretien","label":"Présence à l''entretien (vous êtes présenté / ne vous êtes pas présenté)","type":"text"},
  {"key":"motif_licenciement","label":"Motif détaillé","type":"textarea"},
  {"key":"duree_preavis","label":"Durée du préavis","type":"text"},
  {"key":"date_fin_preavis","label":"Date de fin de préavis","type":"date"},
  {"key":"nom_signataire","label":"Nom du signataire","type":"text"},
  {"key":"fonction_signataire","label":"Fonction du signataire","type":"text"}
]'::jsonb),

('Contrat de travail à durée déterminée (CDD)', 'Modèle simplifié de CDD à temps plein.', 'contrat', 'FileSignature', true,
$BODY$<h2 style="text-align:center">CONTRAT DE TRAVAIL À DURÉE DÉTERMINÉE</h2>
<p><strong>Entre les soussignés :</strong></p>
<p>La société <strong>{{nom_entreprise}}</strong>, dont le siège est situé {{adresse_entreprise}}, immatriculée sous le numéro SIRET {{siret_entreprise}}, représentée par {{nom_signataire}} en qualité de {{fonction_signataire}},</p>
<p style="text-align:center">d''une part,</p>
<p><strong>{{civilite_salarie}} {{prenom_salarie}} {{nom_salarie}}</strong>, demeurant {{adresse_salarie}}, né(e) le {{date_naissance}} à {{lieu_naissance}}, de nationalité {{nationalite}}, immatriculé(e) à la Sécurité sociale sous le numéro {{numero_secu}},</p>
<p style="text-align:center">d''autre part,</p>
<p><strong>Il a été convenu ce qui suit :</strong></p>
<p><strong>Article 1 — Engagement et motif du recours</strong></p>
<p>{{civilite_salarie}} {{nom_salarie}} est engagé(e) en qualité de <strong>{{poste}}</strong>, statut {{statut}}, position {{position_classification}} de la convention collective {{convention_collective}}, pour le motif suivant : {{motif_cdd}}.</p>
<p><strong>Article 2 — Durée</strong></p>
<p>Le présent contrat est conclu pour une durée déterminée du {{date_debut}} au {{date_fin}}.</p>
<p>Une période d''essai de {{duree_essai}} est prévue.</p>
<p><strong>Article 3 — Lieu et horaires de travail</strong></p>
<p>Le lieu de travail est fixé à {{lieu_travail}}. La durée hebdomadaire est de {{duree_travail}} heures.</p>
<p><strong>Article 4 — Rémunération</strong></p>
<p>La rémunération brute mensuelle est fixée à <strong>{{salaire_brut}} euros</strong>, payable mensuellement.</p>
<p><strong>Article 5 — Congés payés</strong></p>
<p>Le salarié bénéficie des congés payés dans les conditions prévues par le Code du travail.</p>
<p><strong>Article 6 — Indemnité de fin de contrat</strong></p>
<p>À l''issue du contrat, sauf cas d''exclusion légale, le salarié percevra une indemnité de fin de contrat égale à 10 % de la rémunération totale brute.</p>
<p>Fait en double exemplaire à {{ville_signature}}, le {{date_signature}}.</p>
<p style="margin-top:32px"><strong>Le salarié</strong>{{tab}}{{tab}}{{tab}}<strong>L''employeur</strong></p>$BODY$::text,
'[
  {"key":"nom_entreprise","label":"Nom de l''entreprise","type":"text"},
  {"key":"adresse_entreprise","label":"Adresse du siège","type":"text"},
  {"key":"siret_entreprise","label":"SIRET","type":"text"},
  {"key":"nom_signataire","label":"Nom du représentant","type":"text"},
  {"key":"fonction_signataire","label":"Fonction du représentant","type":"text"},
  {"key":"civilite_salarie","label":"Civilité","type":"text"},
  {"key":"prenom_salarie","label":"Prénom","type":"text"},
  {"key":"nom_salarie","label":"Nom","type":"text"},
  {"key":"adresse_salarie","label":"Adresse","type":"textarea"},
  {"key":"date_naissance","label":"Date de naissance","type":"date"},
  {"key":"lieu_naissance","label":"Lieu de naissance","type":"text"},
  {"key":"nationalite","label":"Nationalité","type":"text"},
  {"key":"numero_secu","label":"N° de Sécurité sociale","type":"text"},
  {"key":"poste","label":"Intitulé du poste","type":"text"},
  {"key":"statut","label":"Statut (Employé / Cadre…)","type":"text"},
  {"key":"position_classification","label":"Position / classification","type":"text"},
  {"key":"convention_collective","label":"Convention collective","type":"text"},
  {"key":"motif_cdd","label":"Motif du recours au CDD","type":"textarea"},
  {"key":"date_debut","label":"Date de début","type":"date"},
  {"key":"date_fin","label":"Date de fin","type":"date"},
  {"key":"duree_essai","label":"Durée de la période d''essai","type":"text"},
  {"key":"lieu_travail","label":"Lieu de travail","type":"text"},
  {"key":"duree_travail","label":"Durée hebdomadaire (heures)","type":"text"},
  {"key":"salaire_brut","label":"Salaire brut mensuel (€)","type":"text"},
  {"key":"ville_signature","label":"Ville de signature","type":"text"},
  {"key":"date_signature","label":"Date de signature","type":"date"}
]'::jsonb),

('Mise en demeure de payer', 'Lettre de mise en demeure adressée à un débiteur.', 'mise-en-demeure', 'Scale', true,
$BODY$<p><strong>{{nom_creancier}}</strong><br/>{{adresse_creancier}}</p>
<p style="text-align:right">{{ville_creancier}}, le {{date_courrier}}</p>
<p><strong>{{nom_debiteur}}</strong><br/>{{adresse_debiteur}}</p>
<p><strong>Objet : Mise en demeure de payer</strong><br/>Lettre recommandée avec accusé de réception</p>
<p>Madame, Monsieur,</p>
<p>Sauf erreur ou omission de notre part, nous constatons que vous restez redevable de la somme de <strong>{{montant_du}} €</strong> au titre de {{nature_creance}} (facture n° {{numero_facture}} du {{date_facture}}, échéance le {{date_echeance}}).</p>
<p>Malgré nos précédentes relances, ce montant demeure impayé à ce jour.</p>
<p>Par la présente, nous vous mettons en demeure de procéder au règlement de cette somme dans un délai de <strong>{{delai_paiement}} jours</strong> à compter de la réception de la présente lettre.</p>
<p>À défaut de paiement dans ce délai, nous nous réservons le droit d''engager toute action contentieuse utile, et notamment une procédure judiciaire d''injonction de payer, sans nouvel avis de notre part.</p>
<p>La présente vaut mise en demeure au sens des articles 1231-6 et 1344 du Code civil et fait courir les intérêts de retard au taux légal.</p>
<p>Veuillez agréer, Madame, Monsieur, l''expression de nos salutations distinguées.</p>
<p>{{nom_signataire}}<br/>{{fonction_signataire}}</p>$BODY$::text,
'[
  {"key":"nom_creancier","label":"Nom du créancier","type":"text"},
  {"key":"adresse_creancier","label":"Adresse du créancier","type":"text"},
  {"key":"ville_creancier","label":"Ville","type":"text"},
  {"key":"date_courrier","label":"Date du courrier","type":"date"},
  {"key":"nom_debiteur","label":"Nom du débiteur","type":"text"},
  {"key":"adresse_debiteur","label":"Adresse du débiteur","type":"textarea"},
  {"key":"montant_du","label":"Montant dû (€)","type":"text"},
  {"key":"nature_creance","label":"Nature de la créance","type":"text"},
  {"key":"numero_facture","label":"N° de facture","type":"text"},
  {"key":"date_facture","label":"Date de la facture","type":"date"},
  {"key":"date_echeance","label":"Date d''échéance","type":"date"},
  {"key":"delai_paiement","label":"Délai de paiement (jours)","type":"text"},
  {"key":"nom_signataire","label":"Nom du signataire","type":"text"},
  {"key":"fonction_signataire","label":"Fonction du signataire","type":"text"}
]'::jsonb);