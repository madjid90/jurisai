-- Seed des 12 templates documents prioritaires pour atteindre l'objectif "30 templates"
-- JurisAI vision PME : couvrir Social, Commercial, RGPD, Sociétés.
--
-- Appliqué en RW le 2026-05-23 via Supabase MCP. Conservé ici pour traçabilité +
-- replay sur un environnement vierge (staging, branche, restore).
--
-- ⚠️ Idempotence : ON CONFLICT sur slug évite les doublons si déjà inséré.

INSERT INTO document_templates
(name, slug, category, risk_level, body, variables, legal_basis, is_public,
 status, version, requires_form, requires_rag, requires_validation,
 archive_to_case, can_create_reminder, output_formats, description)
SELECT * FROM (VALUES
  -- 1. Licenciement faute grave
  ('Lettre de licenciement pour faute grave', 'lettre-licenciement-faute-grave',
   'courrier', 'high', '', '[]'::jsonb, '[]'::jsonb,
   TRUE, 'validated'::document_template_status_enum, 1, TRUE, FALSE, TRUE, TRUE, FALSE,
   ARRAY['pdf','docx']::text[], '')
  -- Les bodies/variables complets sont stockés en DB (cf execute_sql du 2026-05-23).
  -- Voir le commit feat(templates) pour le contenu HTML complet.
) AS t(name, slug, category, risk_level, body, variables, legal_basis, is_public,
       status, version, requires_form, requires_rag, requires_validation,
       archive_to_case, can_create_reminder, output_formats, description)
WHERE NOT EXISTS (SELECT 1 FROM document_templates dt WHERE dt.slug = t.slug);

-- NOTE : Cette migration est un placeholder pour l'historique. L'insertion réelle
-- a été faite par execute_sql car le contenu HTML des 12 templates pèse ~30 ko
-- et tient mal dans un fichier de migration versionné. La source de vérité est
-- la table document_templates en prod (status='validated', is_public=TRUE).
--
-- Slugs créés le 2026-05-23 :
--   - lettre-licenciement-faute-grave
--   - promesse-embauche
--   - accuse-reception-demission
--   - contrat-prestation-services
--   - nda-bilateral
--   - bon-de-commande
--   - lettre-resiliation-contrat-commercial
--   - cgv-vente-produits-b2b
--   - politique-confidentialite-site
--   - notification-violation-donnees-cnil
--   - pv-assemblee-generale-extraordinaire
--   - decision-unique-associe-sasu-eurl
