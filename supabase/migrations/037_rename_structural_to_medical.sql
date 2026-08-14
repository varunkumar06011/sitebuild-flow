-- ============================================================================
-- Meditrust ERP — Rename 'structural' work category to 'medical'
-- ============================================================================
-- Renames the existing 'structural' work category to 'medical' across all
-- tables that carry the work_category column.
--
-- Civil  = construction materials used to BUILD the hospital
-- Medical = equipment/furniture/machinery used INSIDE the hospital
-- ============================================================================

-- 1. Update the work_categories lookup table
UPDATE work_categories
  SET name        = 'medical',
      label       = 'Medical Work',
      description = 'Hospital equipment, furniture, and machinery used inside the hospital (beds, MRI scanners, chairs, medical equipment, machinery, etc.)'
  WHERE name = 'structural';

-- 2. Update work_category columns in all relevant tables
UPDATE inventory_items  SET work_category = 'medical' WHERE work_category = 'structural';
UPDATE vendors           SET work_category = 'medical' WHERE work_category = 'structural';
UPDATE work_orders       SET work_category = 'medical' WHERE work_category = 'structural';
UPDATE parts_orders      SET work_category = 'medical' WHERE work_category = 'structural';
UPDATE documents         SET work_category = 'medical' WHERE work_category = 'structural';
UPDATE progress_blocks   SET work_category = 'medical' WHERE work_category = 'structural';
