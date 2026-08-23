-- ============================================================================
-- Meditrust ERP — Phase 3: Unit/Room number bolt-on
-- ============================================================================
-- Adds an optional unit_number text column to progress_cells.
-- Nullable, purely additive — no change to the cell_groups → cells relationship
-- or the existing cell_count auto-generation logic.
-- ============================================================================

ALTER TABLE progress_cells
  ADD COLUMN IF NOT EXISTS unit_number text;
