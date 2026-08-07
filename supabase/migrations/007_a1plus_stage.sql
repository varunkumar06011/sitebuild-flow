-- ============================================================================
-- Meditrust ERP — Add A1+ stage to procurement_stage enum
-- ============================================================================
-- Adds a dedicated 'A1+' stage so items above ₹5,00,000 are correctly
-- staged as awaiting A1+ approval, not lumped into 'A1'.
-- ============================================================================

DO $$ BEGIN
  ALTER TYPE procurement_stage ADD VALUE 'A1+' AFTER 'A1';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
