-- 031_storage_buckets.sql
-- Creates Supabase Storage buckets for documents and photos.
-- These buckets are used by the storage API (server/routes/storage.ts)
-- and the drawings upload API (src/lib/api/drawings.ts) for file storage.

-- ============================================================================
-- Storage Buckets: documents and photos
-- ============================================================================
-- Buckets are created via the storage schema's insert into buckets table.
-- Both buckets are private (public = false) — access is via signed URLs only.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'documents', 'documents', false, 10485760, ARRAY[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/heic',
  'image/heif',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream'
]
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documents');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'photos', 'photos', false, 5242880, ARRAY[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff'
]
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'photos');

-- ============================================================================
-- Storage Policies
-- ============================================================================
-- No direct client access — all uploads and signed URL generation go through
-- the Express API server using the service_role key.
-- These policies deny all access to anon and authenticated roles.

DROP POLICY IF EXISTS "documents_deny_all" ON storage.objects;
CREATE POLICY "documents_deny_all" ON storage.objects
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "photos_deny_all" ON storage.objects;
CREATE POLICY "photos_deny_all" ON storage.objects
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
