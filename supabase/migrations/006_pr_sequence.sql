-- ============================================================================
-- Meditrust ERP — PR Sequential Numbering
-- ============================================================================
-- Replaces the random PR-{rand} generation with a global atomic sequence.
-- Format: PR/0001 (zero-padded, never resets).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Global PR sequence (single row — never resets)
-- ----------------------------------------------------------------------------
-- Single-row table holding the global purchase requisition counter.
CREATE TABLE IF NOT EXISTS pr_global_seq (
  id        int PRIMARY KEY DEFAULT 1,
  last_seq  bigint NOT NULL DEFAULT 0,
  CONSTRAINT pr_single_row CHECK (id = 1)
);

-- Seed the singleton sequence row.
INSERT INTO pr_global_seq (id, last_seq) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

-- Migrate existing PR numbers: extract the numeric suffix from PR-XXXX
UPDATE pr_global_seq
SET last_seq = GREATEST(last_seq, COALESCE(
  (SELECT COALESCE(MAX(
    CASE
      WHEN pr_number ~ '^PR-?/?[0-9]+$'
        THEN CAST(SUBSTRING(pr_number FROM '[0-9]+') AS bigint)
      ELSE 0
    END
  ), 0) FROM requisitions),
  0
));

-- ----------------------------------------------------------------------------
-- next_pr_number() — atomic increment, returns PR/0001 format
-- ----------------------------------------------------------------------------
-- Atomically increments the global counter and returns the next PR/0001 number.
CREATE OR REPLACE FUNCTION next_pr_number()
RETURNS text AS $$
DECLARE
  next_seq bigint;
  pr_num   text;
BEGIN
  UPDATE pr_global_seq
    SET last_seq = last_seq + 1
    WHERE id = 1
    RETURNING last_seq INTO next_seq;

  pr_num := 'PR/' || LPAD(next_seq::text, 4, '0');
  RETURN pr_num;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS on the new table
ALTER TABLE pr_global_seq ENABLE ROW LEVEL SECURITY;
-- Revoke direct access on the sequence table from anon and authenticated.
REVOKE ALL ON pr_global_seq FROM anon, authenticated;
