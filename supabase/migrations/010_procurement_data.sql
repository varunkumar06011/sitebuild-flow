-- ============================================================================
-- Meditrust ERP — Procurement Data Completeness Migration
-- ============================================================================
-- Adds missing columns to capture granular data at each pipeline stage:
--   - Material Received: GRN number, delivery date, quantity received
--   - Invoice: invoice number, invoice date, invoice amount
--   - Approval: approved_by, approved_at, rejected_by, rejected_at, rejection_reason
--   - vendor_payments: reference_number (cheque/UPI/transaction ID), requisition_id link
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Requisitions: add stage-specific columns
-- ----------------------------------------------------------------------------
ALTER TABLE requisitions
  ADD COLUMN IF NOT EXISTS grn_number        text,
  ADD COLUMN IF NOT EXISTS delivery_date     timestamptz,
  ADD COLUMN IF NOT EXISTS quantity_received numeric,
  ADD COLUMN IF NOT EXISTS invoice_number    text,
  ADD COLUMN IF NOT EXISTS invoice_date      timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_amount    numeric,
  ADD COLUMN IF NOT EXISTS approved_by       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rejected_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason  text;

-- ----------------------------------------------------------------------------
-- Vendor payments: add reference_number + requisition link
-- ----------------------------------------------------------------------------
ALTER TABLE vendor_payments
  ADD COLUMN IF NOT EXISTS reference_number  text,
  ADD COLUMN IF NOT EXISTS requisition_id    uuid REFERENCES requisitions(id) ON DELETE SET NULL;

-- Index for looking up payments by requisition
CREATE INDEX IF NOT EXISTS idx_vendor_payments_requisition_id ON vendor_payments(requisition_id);

-- ----------------------------------------------------------------------------
-- GRN global sequence (same pattern as PR and PO)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grn_global_seq (
  id        int PRIMARY KEY DEFAULT 1,
  last_seq  bigint NOT NULL DEFAULT 0,
  CONSTRAINT grn_single_row CHECK (id = 1)
);

INSERT INTO grn_global_seq (id, last_seq) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

-- Migrate existing GRN numbers if any
UPDATE grn_global_seq
SET last_seq = GREATEST(last_seq, COALESCE(
  (SELECT COALESCE(MAX(
    CASE
      WHEN grn_number ~ '^GRN/?[0-9]+$'
        THEN CAST(SUBSTRING(grn_number FROM '[0-9]+') AS bigint)
      ELSE 0
    END
  ), 0) FROM requisitions WHERE grn_number IS NOT NULL),
  0
));

-- next_grn_number() — atomic increment, returns GRN/0001 format
CREATE OR REPLACE FUNCTION next_grn_number()
RETURNS text AS $$
DECLARE
  next_seq bigint;
  grn_num  text;
BEGIN
  UPDATE grn_global_seq
    SET last_seq = last_seq + 1
    WHERE id = 1
    RETURNING last_seq INTO next_seq;

  grn_num := 'GRN/' || LPAD(next_seq::text, 4, '0');
  RETURN grn_num;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE grn_global_seq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON grn_global_seq FROM anon, authenticated;
