-- ============================================================================
-- Meditrust ERP — Inventory Alerts (persistent low-stock alerts)
-- ============================================================================
-- Stores low-stock alerts as rows so they have memory (when did stock first
-- drop low?) and a resolve workflow (admin marks "I've reordered this").
-- A trigger fires after every inventory_transactions INSERT to auto-create
-- or update an open alert for that item.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- inventory_alerts — one open alert per item, closeable by admin
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_alerts (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id                 uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  stock_at_alert          numeric NOT NULL,
  reorder_level_at_alert  numeric NOT NULL,
  is_resolved             boolean NOT NULL DEFAULT false,
  resolved_by             uuid REFERENCES users(id),
  resolved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Unique index: only one open (unresolved) alert per item at a time.
-- This lets the trigger use ON CONFLICT to upsert instead of creating duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_alerts_open_item
  ON inventory_alerts (item_id)
  WHERE NOT is_resolved;

-- Speeds up listing open alerts.
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_resolved ON inventory_alerts(is_resolved);

-- ----------------------------------------------------------------------------
-- RLS — deny all direct access; reachable only through server functions
-- ----------------------------------------------------------------------------
ALTER TABLE inventory_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_alerts FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Trigger: auto-create / update alert after every stock movement
-- ----------------------------------------------------------------------------
-- After any INSERT on inventory_transactions, look up the item's current stock
-- (from the existing inventory_stock_levels view) and its reorder level.
-- If current stock <= reorder level, upsert an open alert for that item.
CREATE OR REPLACE FUNCTION check_inventory_low_stock()
RETURNS trigger AS $$
DECLARE
  v_current_stock   numeric;
  v_reorder_level   numeric;
BEGIN
  -- Fetch current stock and reorder level from the computed view
  SELECT current_stock, reorder_level
    INTO v_current_stock, v_reorder_level
  FROM inventory_stock_levels
  WHERE item_id = NEW.item_id;

  -- If stock is at or below reorder level, upsert an open alert
  IF v_current_stock IS NOT NULL AND v_current_stock <= v_reorder_level THEN
    INSERT INTO inventory_alerts (item_id, stock_at_alert, reorder_level_at_alert)
    VALUES (NEW.item_id, v_current_stock, v_reorder_level)
    ON CONFLICT (item_id) WHERE NOT is_resolved
    DO UPDATE SET
      stock_at_alert         = EXCLUDED.stock_at_alert,
      reorder_level_at_alert = EXCLUDED.reorder_level_at_alert;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_low_stock_check ON inventory_transactions;
CREATE TRIGGER trg_inventory_low_stock_check
  AFTER INSERT ON inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION check_inventory_low_stock();
