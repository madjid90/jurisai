-- ============================================================================
-- FIX A1: RLS sur les 6 tables calculateur
-- FIX A3: has_role() function dans les migrations
-- ============================================================================

-- ─── has_role() — utilisée par 120+ policies RLS ────────────────────────────
-- Vérifie si l'utilisateur courant a un rôle spécifique dans un tenant donné.
-- Si la fonction existe déjà (créée via Dashboard), on la remplace.

CREATE OR REPLACE FUNCTION public.has_role(p_tenant_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND tenant_id = p_tenant_id
      AND role = p_role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_member_of_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND tenant_id = p_tenant_id
  );
$$;

-- ─── RLS sur reference_values ───────────────────────────────────────────────
ALTER TABLE reference_values ENABLE ROW LEVEL SECURITY;

-- Lecture : tout utilisateur authentifié (données publiques de référence)
CREATE POLICY "ref_values_read_authenticated" ON reference_values
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Écriture : uniquement via service_role (admin/cron)
CREATE POLICY "ref_values_write_service_only" ON reference_values
  FOR INSERT WITH CHECK (false);
CREATE POLICY "ref_values_update_service_only" ON reference_values
  FOR UPDATE USING (false);
CREATE POLICY "ref_values_delete_service_only" ON reference_values
  FOR DELETE USING (false);

-- ─── RLS sur macron_scale ───────────────────────────────────────────────────
ALTER TABLE macron_scale ENABLE ROW LEVEL SECURITY;

CREATE POLICY "macron_read_authenticated" ON macron_scale
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "macron_write_service_only" ON macron_scale
  FOR INSERT WITH CHECK (false);
CREATE POLICY "macron_update_service_only" ON macron_scale
  FOR UPDATE USING (false);
CREATE POLICY "macron_delete_service_only" ON macron_scale
  FOR DELETE USING (false);

-- ─── RLS sur indemnity_formulas ─────────────────────────────────────────────
ALTER TABLE indemnity_formulas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "formulas_read_authenticated" ON indemnity_formulas
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "formulas_write_service_only" ON indemnity_formulas
  FOR INSERT WITH CHECK (false);
CREATE POLICY "formulas_update_service_only" ON indemnity_formulas
  FOR UPDATE USING (false);
CREATE POLICY "formulas_delete_service_only" ON indemnity_formulas
  FOR DELETE USING (false);

-- ─── RLS sur convention_indemnity_scales ─────────────────────────────────────
ALTER TABLE convention_indemnity_scales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conv_scales_read_authenticated" ON convention_indemnity_scales
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "conv_scales_write_service_only" ON convention_indemnity_scales
  FOR INSERT WITH CHECK (false);
CREATE POLICY "conv_scales_update_service_only" ON convention_indemnity_scales
  FOR UPDATE USING (false);
CREATE POLICY "conv_scales_delete_service_only" ON convention_indemnity_scales
  FOR DELETE USING (false);

-- ─── RLS sur prescription_periods ───────────────────────────────────────────
ALTER TABLE prescription_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prescriptions_read_authenticated" ON prescription_periods
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "prescriptions_write_service_only" ON prescription_periods
  FOR INSERT WITH CHECK (false);
CREATE POLICY "prescriptions_update_service_only" ON prescription_periods
  FOR UPDATE USING (false);
CREATE POLICY "prescriptions_delete_service_only" ON prescription_periods
  FOR DELETE USING (false);

-- ─── RLS sur bareme_update_log ──────────────────────────────────────────────
ALTER TABLE bareme_update_log ENABLE ROW LEVEL SECURITY;

-- Lecture : admins uniquement (audit trail sensible)
CREATE POLICY "bareme_log_read_admin" ON bareme_update_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "bareme_log_write_service_only" ON bareme_update_log
  FOR INSERT WITH CHECK (false);
CREATE POLICY "bareme_log_update_service_only" ON bareme_update_log
  FOR UPDATE USING (false);
CREATE POLICY "bareme_log_delete_service_only" ON bareme_update_log
  FOR DELETE USING (false);
