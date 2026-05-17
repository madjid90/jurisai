-- Colonne profiles.product_tour_completed_at
-- Évite l'utilisation de supabaseAdmin.auth.admin.updateUserById qui retourne
-- "User not allowed" quand SUPABASE_SERVICE_ROLE_KEY n'est pas un vrai service role
-- (cas Lovable Cloud où l'env var peut fallback sur anon key).
--
-- Déjà appliquée via Supabase MCP — référence Git.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS product_tour_completed_at timestamptz;

COMMENT ON COLUMN public.profiles.product_tour_completed_at IS
  'Date de complétion (ou skip) du tour produit. NULL = tour pas encore vu.';
