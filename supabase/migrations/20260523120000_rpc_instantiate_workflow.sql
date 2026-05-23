-- RPC SECURITY DEFINER pour instantiate_workflow.
-- Appliqué via Supabase MCP le 2026-05-23. Versionné ici pour reproductibilité.
--
-- Objectif : permettre à l'outil agent `start_workflow` d'instancier un
-- workflow_instance même si supabaseAdmin n'a pas un vrai JWT service_role
-- (cas Lovable où SUPABASE_SERVICE_ROLE_KEY peut être une anon key). Le
-- garde-fou tenant est explicite dans la fonction.

CREATE OR REPLACE FUNCTION public.instantiate_workflow(
  _user_id uuid,
  _tenant_id uuid,
  _definition_id uuid,
  _title text,
  _dossier_id uuid DEFAULT NULL,
  _client_id uuid DEFAULT NULL,
  _context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_instance_id uuid;
  v_def_tenant uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'User % does not belong to tenant %', _user_id, _tenant_id;
  END IF;

  SELECT tenant_id INTO v_def_tenant
  FROM public.workflow_definitions
  WHERE id = _definition_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow definition % not found', _definition_id;
  END IF;

  IF v_def_tenant IS NOT NULL AND v_def_tenant <> _tenant_id THEN
    RAISE EXCEPTION 'Workflow definition % not accessible by tenant %', _definition_id, _tenant_id;
  END IF;

  IF _dossier_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.dossiers
      WHERE id = _dossier_id AND tenant_id = _tenant_id
    ) THEN
      RAISE EXCEPTION 'Dossier % not in tenant %', _dossier_id, _tenant_id;
    END IF;
  END IF;

  INSERT INTO public.workflow_instances (
    tenant_id, definition_id, title, dossier_id, client_id,
    started_by, context, status, current_step_index
  ) VALUES (
    _tenant_id, _definition_id, left(_title, 200), _dossier_id, _client_id,
    _user_id, _context, 'in_progress', 0
  )
  RETURNING id INTO v_instance_id;

  RETURN jsonb_build_object(
    'instance_id', v_instance_id,
    'title', left(_title, 200),
    'status', 'in_progress'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.instantiate_workflow(
  uuid, uuid, uuid, text, uuid, uuid, jsonb
) TO authenticated, service_role;
