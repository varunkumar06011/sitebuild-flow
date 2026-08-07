-- ============================================================================
-- Meditrust ERP — Progress Tracking Module Migration
-- ============================================================================
-- Creates the full hierarchy: blocks → floors → categories → work items
-- → cell groups → cells (with photos, history, supervisor assignments)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- Blocks (top-level of the hierarchy)
CREATE TABLE IF NOT EXISTS progress_blocks (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Ensure uniqueness on block name (prevents duplicate seed rows)
DO $$ BEGIN
  DELETE FROM progress_blocks a USING progress_blocks b
    WHERE a.name = b.name AND a.id > b.id;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_blocks_name_unique ON progress_blocks(name);
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Floors (child of a block)
CREATE TABLE IF NOT EXISTS progress_floors (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  block_id    uuid NOT NULL REFERENCES progress_blocks(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Categories (reusable across all blocks/floors — e.g. "Civil", "MEP", "Finishing")
CREATE TABLE IF NOT EXISTS progress_categories (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Ensure uniqueness on category name
DO $$ BEGIN
  DELETE FROM progress_categories a USING progress_categories b
    WHERE a.name = b.name AND a.id > b.id;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_categories_name_unique ON progress_categories(name);
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Work items (the "work description" — child of a category)
CREATE TABLE IF NOT EXISTS progress_work_items (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id uuid NOT NULL REFERENCES progress_categories(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Ensure uniqueness on work item name within a category
DO $$ BEGIN
  DELETE FROM progress_work_items a USING progress_work_items b
    WHERE a.category_id = b.category_id AND a.name = b.name AND a.id > b.id;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_work_items_cat_name_unique ON progress_work_items(category_id, name);
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Cell groups (admin sets "No. of Cells" for a Block+Floor+WorkItem combo)
CREATE TABLE IF NOT EXISTS progress_cell_groups (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  block_id      uuid NOT NULL REFERENCES progress_blocks(id) ON DELETE CASCADE,
  floor_id      uuid NOT NULL REFERENCES progress_floors(id) ON DELETE CASCADE,
  work_item_id  uuid NOT NULL REFERENCES progress_work_items(id) ON DELETE CASCADE,
  cell_count    int NOT NULL CHECK (cell_count > 0),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Cells (auto-generated when a cell group is created — 1..cell_count)
CREATE TABLE IF NOT EXISTS progress_cells (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cell_group_id         uuid NOT NULL REFERENCES progress_cell_groups(id) ON DELETE CASCADE,
  cell_number           int NOT NULL,
  status                text NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started','in_progress','completed','on_hold')),
  completion_pct        numeric NOT NULL DEFAULT 0
                        CHECK (completion_pct >= 0 AND completion_pct <= 100),
  remarks               text,
  assigned_supervisor_id uuid REFERENCES users(id),
  updated_by            uuid REFERENCES users(id),
  updated_at            timestamptz,
  UNIQUE(cell_group_id, cell_number)
);

-- Cell photos (many per cell, append-only)
CREATE TABLE IF NOT EXISTS progress_cell_photos (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cell_id       uuid NOT NULL REFERENCES progress_cells(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  caption       text,
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

-- Cell history (append-only, one row per supervisor update)
CREATE TABLE IF NOT EXISTS progress_cell_history (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cell_id         uuid NOT NULL REFERENCES progress_cells(id) ON DELETE CASCADE,
  changed_by      uuid NOT NULL REFERENCES users(id),
  previous_status text,
  new_status      text,
  previous_pct    numeric,
  new_pct         numeric,
  remarks         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Supervisor assignments (who can edit what)
CREATE TABLE IF NOT EXISTS progress_supervisor_assignments (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  supervisor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  block_id      uuid NOT NULL REFERENCES progress_blocks(id) ON DELETE CASCADE,
  floor_id      uuid REFERENCES progress_floors(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(supervisor_id, block_id, floor_id)
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
-- Speeds up listing floors under a given block.
CREATE INDEX IF NOT EXISTS idx_progress_floors_block ON progress_floors(block_id);
-- Speeds up listing work items under a given category.
CREATE INDEX IF NOT EXISTS idx_progress_work_items_category ON progress_work_items(category_id);
-- Speeds up finding cell groups for a given block.
CREATE INDEX IF NOT EXISTS idx_progress_cell_groups_block ON progress_cell_groups(block_id);
-- Speeds up finding cell groups for a given floor.
CREATE INDEX IF NOT EXISTS idx_progress_cell_groups_floor ON progress_cell_groups(floor_id);
-- Speeds up finding cell groups for a given work item.
CREATE INDEX IF NOT EXISTS idx_progress_cell_groups_work_item ON progress_cell_groups(work_item_id);
-- Speeds up listing cells within a cell group.
CREATE INDEX IF NOT EXISTS idx_progress_cells_group ON progress_cells(cell_group_id);
-- Speeds up finding cells assigned to a supervisor.
CREATE INDEX IF NOT EXISTS idx_progress_cells_supervisor ON progress_cells(assigned_supervisor_id);
-- Speeds up listing photos attached to a cell.
CREATE INDEX IF NOT EXISTS idx_progress_cell_photos_cell ON progress_cell_photos(cell_id);
-- Speeds up retrieving history for a cell.
CREATE INDEX IF NOT EXISTS idx_progress_cell_history_cell ON progress_cell_history(cell_id);
-- Speeds up listing assignments for a supervisor.
CREATE INDEX IF NOT EXISTS idx_progress_supervisor_assignments_supervisor ON progress_supervisor_assignments(supervisor_id);
-- Speeds up listing assignments for a block.
CREATE INDEX IF NOT EXISTS idx_progress_supervisor_assignments_block ON progress_supervisor_assignments(block_id);

-- ----------------------------------------------------------------------------
-- RLS — Defense in Depth (deny all for anon/authenticated)
-- ----------------------------------------------------------------------------
-- Enable RLS on all progress tables (deny-all; access via service_role functions).
ALTER TABLE progress_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_cell_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_cell_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_cell_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_supervisor_assignments ENABLE ROW LEVEL SECURITY;

-- Revoke all direct table access from anon and authenticated roles.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Seed Data
-- ----------------------------------------------------------------------------

-- Blocks
DO $$
DECLARE
  admin_id uuid := (SELECT id FROM users WHERE username = 'admin');
BEGIN
  INSERT INTO progress_blocks (name, sort_order, created_by) VALUES
    ('OT Block', 1, admin_id),
    ('ICU Wing', 2, admin_id),
    ('OPD Block', 3, admin_id),
    ('Diagnostics', 4, admin_id)
  ON CONFLICT (name) DO NOTHING;
END $$;

-- Floors
DO $$
DECLARE
  admin_id uuid := (SELECT id FROM users WHERE username = 'admin');
  ot_block uuid := (SELECT id FROM progress_blocks WHERE name = 'OT Block' LIMIT 1);
  icu_block uuid := (SELECT id FROM progress_blocks WHERE name = 'ICU Wing' LIMIT 1);
  opd_block uuid := (SELECT id FROM progress_blocks WHERE name = 'OPD Block' LIMIT 1);
  diag_block uuid := (SELECT id FROM progress_blocks WHERE name = 'Diagnostics' LIMIT 1);
BEGIN
  INSERT INTO progress_floors (block_id, name, sort_order, created_by) VALUES
    (ot_block, 'Level 1', 1, admin_id),
    (ot_block, 'Level 2', 2, admin_id),
    (ot_block, 'Level 3', 3, admin_id),
    (icu_block, 'Level 1', 1, admin_id),
    (icu_block, 'Level 2', 2, admin_id),
    (opd_block, 'Ground', 1, admin_id),
    (opd_block, 'First Floor', 2, admin_id),
    (diag_block, 'Level 1', 1, admin_id)
  ON CONFLICT DO NOTHING;
END $$;

-- Categories
DO $$
DECLARE
  admin_id uuid := (SELECT id FROM users WHERE username = 'admin');
BEGIN
  INSERT INTO progress_categories (name, sort_order, created_by) VALUES
    ('Civil', 1, admin_id),
    ('MEP', 2, admin_id),
    ('Finishing', 3, admin_id)
  ON CONFLICT (name) DO NOTHING;
END $$;

-- Work items
DO $$
DECLARE
  admin_id uuid := (SELECT id FROM users WHERE username = 'admin');
  civil uuid := (SELECT id FROM progress_categories WHERE name = 'Civil' LIMIT 1);
  mep uuid := (SELECT id FROM progress_categories WHERE name = 'MEP' LIMIT 1);
  finishing uuid := (SELECT id FROM progress_categories WHERE name = 'Finishing' LIMIT 1);
BEGIN
  INSERT INTO progress_work_items (category_id, name, sort_order, created_by) VALUES
    (civil, 'Slab Reinforcement', 1, admin_id),
    (civil, 'Concrete Pour', 2, admin_id),
    (civil, 'Blockwork', 3, admin_id),
    (mep, 'Medical Gas Pipeline', 1, admin_id),
    (mep, 'HVAC Ducting', 2, admin_id),
    (mep, 'Electrical Conduiting', 3, admin_id),
    (finishing, 'Tile Flooring', 1, admin_id),
    (finishing, 'Wall Painting', 2, admin_id),
    (finishing, 'False Ceiling', 3, admin_id)
  ON CONFLICT (category_id, name) DO NOTHING;
END $$;

-- Cell groups + cells (OT Block Level 3 — Slab Reinforcement, 12 cells)
DO $$
DECLARE
  admin_id uuid := (SELECT id FROM users WHERE username = 'admin');
  supervisor_id uuid := (SELECT id FROM users WHERE username = 'supervisor');
  ot_l3 uuid := (SELECT id FROM progress_floors WHERE name = 'Level 3' AND block_id = (SELECT id FROM progress_blocks WHERE name = 'OT Block' LIMIT 1) LIMIT 1);
  slab_reinf uuid := (SELECT id FROM progress_work_items WHERE name = 'Slab Reinforcement' LIMIT 1);
  hvac_duct uuid := (SELECT id FROM progress_work_items WHERE name = 'HVAC Ducting' LIMIT 1);
  med_gas uuid := (SELECT id FROM progress_work_items WHERE name = 'Medical Gas Pipeline' LIMIT 1);
  tile_floor uuid := (SELECT id FROM progress_work_items WHERE name = 'Tile Flooring' LIMIT 1);
  group_id uuid;
  i int;
BEGIN
  -- Group 1: OT Block L3 Slab Reinforcement (12 cells)
  INSERT INTO progress_cell_groups (block_id, floor_id, work_item_id, cell_count, created_by)
  VALUES ((SELECT id FROM progress_blocks WHERE name = 'OT Block' LIMIT 1), ot_l3, slab_reinf, 12, admin_id)
  RETURNING id INTO group_id;

  FOR i IN 1..12 LOOP
    INSERT INTO progress_cells (cell_group_id, cell_number, status, completion_pct, assigned_supervisor_id)
    VALUES (group_id, i,
      CASE WHEN i <= 6 THEN 'completed' WHEN i <= 9 THEN 'in_progress' ELSE 'not_started' END,
      CASE WHEN i <= 6 THEN 100 WHEN i <= 9 THEN 50 + (i - 6) * 10 ELSE 0 END,
      supervisor_id);
  END LOOP;

  -- Group 2: OT Block L3 HVAC Ducting (8 cells)
  INSERT INTO progress_cell_groups (block_id, floor_id, work_item_id, cell_count, created_by)
  VALUES ((SELECT id FROM progress_blocks WHERE name = 'OT Block' LIMIT 1), ot_l3, hvac_duct, 8, admin_id)
  RETURNING id INTO group_id;

  FOR i IN 1..8 LOOP
    INSERT INTO progress_cells (cell_group_id, cell_number, status, completion_pct, assigned_supervisor_id)
    VALUES (group_id, i,
      CASE WHEN i <= 3 THEN 'in_progress' ELSE 'not_started' END,
      CASE WHEN i <= 3 THEN 20 + i * 10 ELSE 0 END,
      supervisor_id);
  END LOOP;

  -- Group 3: ICU Wing L2 Medical Gas Pipeline (6 cells)
  INSERT INTO progress_cell_groups (block_id, floor_id, work_item_id, cell_count, created_by)
  VALUES ((SELECT id FROM progress_blocks WHERE name = 'ICU Wing' LIMIT 1),
          (SELECT id FROM progress_floors WHERE name = 'Level 2' AND block_id = (SELECT id FROM progress_blocks WHERE name = 'ICU Wing' LIMIT 1) LIMIT 1),
          med_gas, 6, admin_id)
  RETURNING id INTO group_id;

  FOR i IN 1..6 LOOP
    INSERT INTO progress_cells (cell_group_id, cell_number, status, completion_pct, assigned_supervisor_id)
    VALUES (group_id, i,
      CASE WHEN i <= 2 THEN 'completed' WHEN i = 3 THEN 'on_hold' ELSE 'not_started' END,
      CASE WHEN i <= 2 THEN 100 WHEN i = 3 THEN 40 ELSE 0 END,
      supervisor_id);
  END LOOP;

  -- Group 4: OPD Block Ground Tile Flooring (10 cells)
  INSERT INTO progress_cell_groups (block_id, floor_id, work_item_id, cell_count, created_by)
  VALUES ((SELECT id FROM progress_blocks WHERE name = 'OPD Block' LIMIT 1),
          (SELECT id FROM progress_floors WHERE name = 'Ground' AND block_id = (SELECT id FROM progress_blocks WHERE name = 'OPD Block' LIMIT 1) LIMIT 1),
          tile_floor, 10, admin_id)
  RETURNING id INTO group_id;

  FOR i IN 1..10 LOOP
    INSERT INTO progress_cells (cell_group_id, cell_number, status, completion_pct, assigned_supervisor_id)
    VALUES (group_id, i,
      CASE WHEN i <= 8 THEN 'completed' ELSE 'in_progress' END,
      CASE WHEN i <= 8 THEN 100 ELSE 60 END,
      supervisor_id);
  END LOOP;
END $$;

-- Supervisor assignments (supervisor covers OT Block and ICU Wing)
DO $$
DECLARE
  supervisor_id uuid := (SELECT id FROM users WHERE username = 'supervisor');
  ot_block uuid := (SELECT id FROM progress_blocks WHERE name = 'OT Block' LIMIT 1);
  icu_block uuid := (SELECT id FROM progress_blocks WHERE name = 'ICU Wing' LIMIT 1);
  opd_block uuid := (SELECT id FROM progress_blocks WHERE name = 'OPD Block' LIMIT 1);
BEGIN
  INSERT INTO progress_supervisor_assignments (supervisor_id, block_id, floor_id) VALUES
    (supervisor_id, ot_block, NULL),
    (supervisor_id, icu_block, NULL),
    (supervisor_id, opd_block, NULL)
  ON CONFLICT DO NOTHING;
END $$;
