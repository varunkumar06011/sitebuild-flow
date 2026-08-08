-- ============================================================================
-- Meditrust ERP — Centralized Documents Module
-- ============================================================================
-- Stores metadata for uploaded documents (PDFs, images, licences, certificates,
-- agreements, bills, etc.) with optional entity linkage, expiry tracking, and
-- OCR-extracted metadata. Files are stored in the existing Supabase "documents"
-- storage bucket; this table holds the structured metadata row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enum: document_type
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE document_type AS ENUM (
    'Licence',
    'Permit',
    'Certificate',
    'Agreement',
    'Bill / Invoice',
    'Receipt',
    'Land Document',
    'Photo / Screenshot',
    'Report',
    'Contract',
    'Other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Enum: expiry_status (computed at read time, but stored for filtering)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE document_expiry_status AS ENUM ('Active', 'Expiring Soon', 'Expired', 'No Expiry');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- documents table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  document_type   document_type NOT NULL DEFAULT 'Other',
  file_path       text NOT NULL,
  file_size       bigint NOT NULL DEFAULT 0,
  content_type    text,
  amount          numeric,
  expiry_date     date,
  licence_number  text,

  -- Optional entity linkage (any combination can be set)
  block_id        uuid REFERENCES progress_blocks(id) ON DELETE SET NULL,
  vendor_id       uuid REFERENCES vendors(id) ON DELETE SET NULL,
  project_name    text,
  customer_name   text,
  related_entity  text,

  -- OCR-extracted metadata (admin can review/edit before saving)
  ocr_text        text,
  ocr_extracted   jsonb,

  uploaded_by     uuid NOT NULL REFERENCES users(id),
  uploaded_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type);
CREATE INDEX IF NOT EXISTS idx_documents_expiry ON documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_documents_block ON documents(block_id);
CREATE INDEX IF NOT EXISTS idx_documents_vendor ON documents(vendor_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at);
CREATE INDEX IF NOT EXISTS idx_documents_name ON documents(name);

-- ----------------------------------------------------------------------------
-- RLS — Defense in Depth
-- ----------------------------------------------------------------------------
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON documents FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER documents_set_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
