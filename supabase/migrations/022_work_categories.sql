-- ============================================================================
-- Meditrust ERP — Work Categories (Civil Work / Structural Work)
-- ============================================================================
-- Creates a centralized work_categories lookup table and adds a work_category
-- column to every relevant table so that Civil vs Structural classification
-- is consistent across all modules (inventory, vendors, work orders, parts
-- orders, documents, progress blocks).
--
-- Existing records default to 'Uncategorized' so nothing breaks.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- work_categories — centralized lookup table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_categories (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text UNIQUE NOT NULL,
  label       text NOT NULL,
  description text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE work_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON work_categories FROM anon, authenticated;

-- Seed the two mandatory categories
INSERT INTO work_categories (name, label, description, sort_order) VALUES
  ('civil',      'Civil Work',      'Construction-related materials and activities (bricks, cement, sand, rods, concrete, pipes, tiles, etc.)', 1),
  ('structural', 'Structural Work', 'Hospital/infrastructure-related equipment, assets, and structural requirements (hospital beds, MRI scanners, medical equipment, major installed assets, etc.)', 2),
  ('uncategorized', 'Uncategorized', 'Default category for legacy records where the work category is not yet assigned.', 3)
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Add work_category column to all relevant tables
-- ----------------------------------------------------------------------------
-- inventory_items
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS work_category text NOT NULL DEFAULT 'uncategorized';

CREATE INDEX IF NOT EXISTS idx_inventory_items_work_category
  ON inventory_items(work_category);

-- vendors
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS work_category text NOT NULL DEFAULT 'uncategorized';

CREATE INDEX IF NOT EXISTS idx_vendors_work_category
  ON vendors(work_category);

-- work_orders
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS work_category text NOT NULL DEFAULT 'uncategorized';

CREATE INDEX IF NOT EXISTS idx_work_orders_work_category
  ON work_orders(work_category);

-- parts_orders
ALTER TABLE parts_orders
  ADD COLUMN IF NOT EXISTS work_category text NOT NULL DEFAULT 'uncategorized';

CREATE INDEX IF NOT EXISTS idx_parts_orders_work_category
  ON parts_orders(work_category);

-- documents
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS work_category text NOT NULL DEFAULT 'uncategorized';

CREATE INDEX IF NOT EXISTS idx_documents_work_category
  ON documents(work_category);

-- progress_blocks (Projects/Sites)
ALTER TABLE progress_blocks
  ADD COLUMN IF NOT EXISTS work_category text NOT NULL DEFAULT 'uncategorized';

CREATE INDEX IF NOT EXISTS idx_progress_blocks_work_category
  ON progress_blocks(work_category);
