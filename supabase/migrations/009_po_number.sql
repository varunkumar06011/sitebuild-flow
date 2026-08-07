-- ============================================================================
-- Meditrust ERP — PO Sequential Numbering
-- ============================================================================
-- Adds a po_number column to requisitions and a global atomic sequence.
-- Format: PO/0001 (zero-padded, never resets).
-- ============================================================================

-- Add po_number column to requisitions (nullable — only set when approved to PO)
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS po_number text;

-- ----------------------------------------------------------------------------
-- Global PO sequence (single row — never resets)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_global_seq (
  id        int PRIMARY KEY DEFAULT 1,
  last_seq  bigint NOT NULL DEFAULT 0,
  CONSTRAINT po_single_row CHECK (id = 1)
);

INSERT INTO po_global_seq (id, last_seq) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

-- Migrate existing PO numbers: extract numeric suffix from any PO-XXXX pattern
UPDATE po_global_seq
SET last_seq = GREATEST(last_seq, COALESCE(
  (SELECT COALESCE(MAX(
    CASE
      WHEN po_number ~ '^PO-?/?[0-9]+$'
        THEN CAST(SUBSTRING(po_number FROM '[0-9]+') AS bigint)
      ELSE 0
    END
  ), 0) FROM requisitions WHERE po_number IS NOT NULL),
  0
));

-- ----------------------------------------------------------------------------
-- next_po_number() — atomic increment, returns PO/0001 format
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_po_number()
RETURNS text AS $$
DECLARE
  next_seq bigint;
  po_num   text;
BEGIN
  UPDATE po_global_seq
    SET last_seq = last_seq + 1
    WHERE id = 1
    RETURNING last_seq INTO next_seq;

  po_num := 'PO/' || LPAD(next_seq::text, 4, '0');
  RETURN po_num;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS on the new table
ALTER TABLE po_global_seq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON po_global_seq FROM anon, authenticated;
