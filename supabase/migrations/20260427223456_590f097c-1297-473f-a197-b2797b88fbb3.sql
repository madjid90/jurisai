
-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dossier-files', 'dossier-files', false,
  20971520, -- 20 MB
  ARRAY['application/pdf','image/png','image/jpeg','image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain']
)
ON CONFLICT (id) DO NOTHING;

-- Path layout enforced by policies: {tenant_id}/{user_id}/{filename}
CREATE POLICY "Tenant members read dossier files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'dossier-files'
    AND public.is_member_of_tenant(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "Tenant members upload dossier files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dossier-files'
    AND public.is_member_of_tenant(auth.uid(), ((storage.foldername(name))[1])::uuid)
    AND ((storage.foldername(name))[2])::uuid = auth.uid()
  );

CREATE POLICY "Owner or admin deletes dossier files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'dossier-files'
    AND (
      ((storage.foldername(name))[2])::uuid = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::public.app_role,
                         ((storage.foldername(name))[1])::uuid)
    )
  );

ALTER TABLE public.document_analyses
  ADD COLUMN IF NOT EXISTS storage_path text;
