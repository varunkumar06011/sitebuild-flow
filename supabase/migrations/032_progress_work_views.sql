-- ============================================================================
-- Meditrust ERP — Phase 2: Work Views as a first-class entity
-- ============================================================================
-- Creates progress_work_views table and links progress_categories to it.
-- Backfills all existing categories with a default "General" Work View (flat).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- progress_work_views — top-level grouping for categories
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS progress_work_views (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  scope       text NOT NULL DEFAULT 'flat'
              CHECK (scope IN ('flat', 'floor', 'block')),
  sort_order  int NOT NULL DEFAULT 0,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE progress_work_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON progress_work_views FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Add work_view_id to progress_categories (nullable first)
-- ----------------------------------------------------------------------------
ALTER TABLE progress_categories
  ADD COLUMN IF NOT EXISTS work_view_id uuid REFERENCES progress_work_views(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- Backfill: create a default "General" Work View and point all existing
-- categories at it
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  admin_id uuid := (SELECT id FROM users WHERE username = 'admin');
  general_id uuid;
BEGIN
  INSERT INTO progress_work_views (name, scope, sort_order, created_by)
  VALUES ('General', 'flat', 0, admin_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO general_id;

  IF general_id IS NULL THEN
    SELECT id INTO general_id FROM progress_work_views WHERE name = 'General' LIMIT 1;
  END IF;

  UPDATE progress_categories
    SET work_view_id = general_id
    WHERE work_view_id IS NULL;
END $$;

-- ----------------------------------------------------------------------------
-- Make work_view_id NOT NULL now that all rows are backfilled
-- ----------------------------------------------------------------------------
ALTER TABLE progress_categories
  ALTER COLUMN work_view_id SET NOT NULL;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_progress_categories_work_view
  ON progress_categories(work_view_id);
