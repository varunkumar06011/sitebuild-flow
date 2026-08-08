-- 021_inventory_enhancements.sql
-- Inventory module enhancements: edit/archive, stock-out validation, linkage to PR/PO/gate pass/batch,
-- reorder quantity, adjustment direction, supplier linkage.

-- ============================================================================
-- Add columns to inventory_items
-- ============================================================================
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reorder_qty numeric NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id);
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_archived ON inventory_items(archived) WHERE archived = false;
CREATE INDEX IF NOT EXISTS idx_inventory_items_supplier ON inventory_items(supplier_id);

-- ============================================================================
-- Add columns to inventory_categories
-- ============================================================================
ALTER TABLE inventory_categories ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_categories ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE inventory_categories ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id);

-- ============================================================================
-- Add columns to inventory_transactions
-- ============================================================================
-- adjustment_direction: 'up' (add) or 'down' (subtract) — for adjustment type only
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS adjustment_direction text CHECK (adjustment_direction IN ('up', 'down'));
-- Linkage to other modules
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS linked_requisition_id uuid REFERENCES requisitions(id) ON DELETE SET NULL;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS linked_gate_pass_id uuid REFERENCES gate_passes(id) ON DELETE SET NULL;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS linked_batch_id uuid REFERENCES batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_tx_requisition ON inventory_transactions(linked_requisition_id) WHERE linked_requisition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_tx_gate_pass ON inventory_transactions(linked_gate_pass_id) WHERE linked_gate_pass_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_tx_batch ON inventory_transactions(linked_batch_id) WHERE linked_batch_id IS NOT NULL;

-- ============================================================================
-- Update the stock levels view to handle adjustment direction
-- ============================================================================
CREATE OR REPLACE VIEW inventory_stock_levels AS
SELECT
  i.id AS item_id,
  i.name AS item_name,
  i.unit_of_measure,
  i.reorder_level,
  i.reorder_qty,
  i.supplier_id,
  i.opening_stock,
  i.category_id,
  i.archived,
  i.opening_stock
    + COALESCE(SUM(CASE WHEN t.type = 'in'          THEN t.quantity ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN t.type = 'out'         THEN t.quantity ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN t.type = 'adjustment'  AND (t.adjustment_direction = 'up' OR t.adjustment_direction IS NULL) THEN t.quantity ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN t.type = 'adjustment'  AND t.adjustment_direction = 'down' THEN t.quantity ELSE 0 END), 0)
    AS current_stock
FROM inventory_items i
LEFT JOIN inventory_transactions t ON t.item_id = i.id
GROUP BY i.id, i.name, i.unit_of_measure, i.reorder_level, i.reorder_qty, i.supplier_id, i.opening_stock, i.category_id, i.archived;

-- ============================================================================
-- RLS for new columns (already deny-all on tables; view is accessible via service_role)
-- ============================================================================
-- No additional RLS needed — existing policies cover the new columns.
