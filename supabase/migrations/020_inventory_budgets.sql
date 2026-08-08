-- ============================================================================
-- Meditrust ERP — Inventory Material Budgets
-- ============================================================================
-- Sets an expected usage quantity (and optionally a rupee value) per item,
-- with an alert threshold percentage. When cumulative 'out' usage crosses
-- the threshold % of budget_qty, the item is flagged as over-budget.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- inventory_budgets — one budget per item (unique on item_id)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_budgets (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id              uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  budget_qty           numeric NOT NULL DEFAULT 0,
  budget_value         numeric NOT NULL DEFAULT 0,
  alert_threshold_pct  numeric NOT NULL DEFAULT 80,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_id)
);

-- Speeds up looking up a budget by item.
CREATE INDEX IF NOT EXISTS idx_inventory_budgets_item ON inventory_budgets(item_id);

-- ----------------------------------------------------------------------------
-- RLS — deny all direct access; reachable only through server functions
-- ----------------------------------------------------------------------------
ALTER TABLE inventory_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_budgets FROM anon, authenticated;
