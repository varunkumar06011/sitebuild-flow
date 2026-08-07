-- ============================================================================
-- Meditrust ERP — Migrate existing >₹5L requisitions to A1+ stage
-- ============================================================================
-- Must run in a separate transaction from 007 (PG cannot use a new enum
-- value in the same transaction that added it).
-- ============================================================================

UPDATE requisitions
  SET stage = 'A1+'
  WHERE stage = 'A1' AND amount > 500000;
