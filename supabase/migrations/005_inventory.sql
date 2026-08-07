-- ============================================================================
-- Meditrust ERP — Inventory Module Migration
-- ============================================================================
-- Self-referencing category tree (Category → Type → Subcategory → Subtype),
-- items at the leaves, transactions (in/out/adjustment), and a stock-level
-- view computed on read (no denormalised current_stock column).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- inventory_categories — single self-referencing tree table
-- ----------------------------------------------------------------------------
-- Self-referencing category tree (Category → Type → Subcategory → Subtype).
CREATE TABLE IF NOT EXISTS inventory_categories (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  level       text NOT NULL CHECK (level IN ('category','type','subcategory','subtype')),
  parent_id   uuid REFERENCES inventory_categories(id) ON DELETE CASCADE,
  sort_order  int NOT NULL DEFAULT 0,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Speeds up fetching child categories of a parent node.
CREATE INDEX IF NOT EXISTS idx_inventory_categories_parent ON inventory_categories(parent_id);
-- Speeds up filtering categories by tree level.
CREATE INDEX IF NOT EXISTS idx_inventory_categories_level ON inventory_categories(level);

-- ----------------------------------------------------------------------------
-- inventory_items — live at the leaves (normally 'subtype')
-- ----------------------------------------------------------------------------
-- Stores individual inventory items attached to a leaf category.
CREATE TABLE IF NOT EXISTS inventory_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id     uuid NOT NULL REFERENCES inventory_categories(id) ON DELETE CASCADE,
  name            text NOT NULL,
  unit_of_measure text,
  reorder_level   numeric NOT NULL DEFAULT 0,
  opening_stock   numeric NOT NULL DEFAULT 0,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Speeds up listing items under a given category.
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category_id);

-- ----------------------------------------------------------------------------
-- inventory_transactions — immutable log of stock movements
-- ----------------------------------------------------------------------------
-- Immutable log of stock in/out/adjustment movements per item.
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id     uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('in','out','adjustment')),
  quantity    numeric NOT NULL CHECK (quantity > 0),
  block_id    uuid REFERENCES progress_blocks(id) ON DELETE SET NULL,
  reference   text,
  remarks     text,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Speeds up listing transactions for a given item.
CREATE INDEX IF NOT EXISTS idx_inventory_tx_item ON inventory_transactions(item_id);
-- Speeds up sorting/filtering transactions by date.
CREATE INDEX IF NOT EXISTS idx_inventory_tx_created ON inventory_transactions(created_at);

-- ----------------------------------------------------------------------------
-- View: inventory_stock_levels — computed on read, never stored
-- ----------------------------------------------------------------------------
-- Computes current stock per item from opening stock and transactions.
CREATE OR REPLACE VIEW inventory_stock_levels AS
SELECT
  i.id AS item_id,
  i.name AS item_name,
  i.unit_of_measure,
  i.reorder_level,
  i.opening_stock,
  i.category_id,
  i.opening_stock
    + COALESCE(SUM(CASE WHEN t.type = 'in'          THEN t.quantity ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN t.type = 'out'         THEN t.quantity ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN t.type = 'adjustment'  THEN t.quantity ELSE 0 END), 0)
    AS current_stock
FROM inventory_items i
LEFT JOIN inventory_transactions t ON t.item_id = i.id
GROUP BY i.id, i.name, i.unit_of_measure, i.reorder_level, i.opening_stock, i.category_id;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
-- Enable RLS on all inventory tables (deny-all; access via service_role).
ALTER TABLE inventory_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions  ENABLE ROW LEVEL SECURITY;

-- Revoke direct access on inventory tables from anon and authenticated.
REVOKE ALL ON inventory_categories  FROM anon, authenticated;
REVOKE ALL ON inventory_items       FROM anon, authenticated;
REVOKE ALL ON inventory_transactions FROM anon, authenticated;

-- View is publicly readable to authenticated roles that pass RLS on underlying tables,
-- but since all access goes through server functions with service_role, no grants needed.
