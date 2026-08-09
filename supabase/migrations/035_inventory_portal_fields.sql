-- ============================================================================
-- Meditrust ERP — Inventory Portal fields
-- ============================================================================
-- Adds the minimal columns needed for the new inventory-portal UX
-- (purchase/usage entry date, vendor, invoice, flat/unit, purpose) without
-- changing the existing inventory calculations or breaking existing modules.
-- ============================================================================

-- Entry date for the transaction (distinct from created_at audit timestamp)
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS transaction_date date NOT NULL DEFAULT now();

-- Link to vendor for purchase entries
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL;

-- Invoice / reference numbers shown on the ledger
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS invoice_number text;

-- Flat / Unit number for usage entries
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS flat_no text;

-- Purpose / Work for usage entries (kept separate from generic remarks)
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS purpose text;

-- Speed up portal ledger filtering by date and lookups by new fields
CREATE INDEX IF NOT EXISTS idx_inventory_tx_date ON inventory_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_vendor ON inventory_transactions(vendor_id) WHERE vendor_id IS NOT NULL;
