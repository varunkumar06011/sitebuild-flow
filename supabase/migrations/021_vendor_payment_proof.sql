-- ============================================================================
-- Meditrust ERP — Vendor Payment Proof & Audit Trail Migration
-- ============================================================================
-- Adds reference_number, status, and audit-tracking columns to
-- vendor_payments. Creates vendor_payment_audit table to preserve the
-- full history of amount/proof/status changes without overwriting old data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Add columns to vendor_payments
-- ----------------------------------------------------------------------------
ALTER TABLE vendor_payments
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS status         text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('pending', 'paid')),
  ADD COLUMN IF NOT EXISTS updated_by     uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz;

-- Existing payments (created before this migration) are all 'paid' by default
-- since they required proof_path at creation time.

-- ----------------------------------------------------------------------------
-- Vendor payment audit table — preserves old values before any update
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_payment_audit (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id      uuid NOT NULL REFERENCES vendor_payments(id) ON DELETE CASCADE,
  old_amount      numeric,
  new_amount      numeric,
  old_status      text,
  new_status      text,
  old_proof_path  text,
  new_proof_path  text,
  old_reference_number text,
  new_reference_number text,
  changed_by      uuid NOT NULL REFERENCES users(id),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  reason          text
);

CREATE INDEX IF NOT EXISTS idx_vendor_payment_audit_payment_id
  ON vendor_payment_audit(payment_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payment_audit_changed_at
  ON vendor_payment_audit(changed_at);

ALTER TABLE vendor_payment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vendor_payment_audit FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Trigger: auto-adjust vendor totals when a payment amount changes
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_vendor_payment_update()
RETURNS trigger AS $$
BEGIN
  -- Only adjust vendor totals if amount actually changed
  IF OLD.amount IS DISTINCT FROM NEW.amount THEN
    UPDATE vendors
      SET
        amount_paid = amount_paid - OLD.amount + NEW.amount,
        outstanding_amount = GREATEST(total_amount - (amount_paid - OLD.amount + NEW.amount), 0)
      WHERE id = NEW.vendor_id;
  END IF;

  -- If status changed to 'pending', subtract from paid; if changed to 'paid', add back
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'pending' THEN
      UPDATE vendors
        SET
          amount_paid = amount_paid - NEW.amount,
          outstanding_amount = GREATEST(total_amount - (amount_paid - NEW.amount), 0)
        WHERE id = NEW.vendor_id;
    ELSIF NEW.status = 'paid' THEN
      UPDATE vendors
        SET
          amount_paid = amount_paid + NEW.amount,
          outstanding_amount = GREATEST(total_amount - (amount_paid + NEW.amount), 0)
        WHERE id = NEW.vendor_id;
    END IF;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendor_payment_update ON vendor_payments;
CREATE TRIGGER trg_vendor_payment_update
  BEFORE UPDATE ON vendor_payments
  FOR EACH ROW
  EXECUTE FUNCTION handle_vendor_payment_update();
