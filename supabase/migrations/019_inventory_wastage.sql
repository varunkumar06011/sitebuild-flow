-- ============================================================================
-- Meditrust ERP — Inventory Wastage Tracking
-- ============================================================================
-- Adds an is_wastage flag to inventory_transactions so that 'out' movements
-- can be distinguished as actual consumption vs. damaged/wasted material.
-- A CHECK constraint ensures the flag is only valid on 'out' transactions.
-- ============================================================================

-- Add is_wastage column with default false (additive, no existing data affected).
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS is_wastage boolean NOT NULL DEFAULT false;

-- CHECK: is_wastage can only be true when type = 'out'.
ALTER TABLE inventory_transactions
  DROP CONSTRAINT IF EXISTS chk_wastage_only_on_out;
ALTER TABLE inventory_transactions
  ADD CONSTRAINT chk_wastage_only_on_out
  CHECK (is_wastage = false OR type = 'out');
