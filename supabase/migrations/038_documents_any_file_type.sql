-- ============================================================================
-- Meditrust ERP — Allow any file type in documents storage bucket
-- ============================================================================
-- Removes the allowed_mime_types restriction on the documents bucket so
-- any file type can be uploaded (PDF, images, Office docs, CAD, video,
-- audio, archives, binary, etc.).
-- The photos bucket remains restricted to image MIME types.
-- ============================================================================

UPDATE storage.buckets
  SET allowed_mime_types = NULL,
      file_size_limit = 104857600
  WHERE id = 'documents';
