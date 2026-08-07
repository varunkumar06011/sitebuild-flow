-- ============================================================================
-- Meditrust ERP — Add Cancelled stage to procurement pipeline
-- ============================================================================
-- Allows withdrawing/cancelling a requisition from any pre-completion stage.
-- ============================================================================

DO $$ BEGIN
  ALTER TYPE procurement_stage ADD VALUE 'Cancelled' AFTER 'Completed';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add cancellation tracking columns
ALTER TABLE requisitions
  ADD COLUMN IF NOT EXISTS cancelled_by  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;
