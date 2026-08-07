-- ============================================================================
-- Meditrust ERP — Vendor Payments Migration
-- ============================================================================
-- Adds materials/payment tracking columns to vendors table and creates a
-- vendor_payments table for individual payment records with mandatory
-- approver, payment type and proof-of-bill fields.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
-- Payment method enum for vendor payments.
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('Cash', 'Cheque', 'UPI', 'NEFT', 'RTGS', 'IMPS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Add payment-tracking columns to vendors
-- ----------------------------------------------------------------------------
-- Adds materials/amount tracking columns to vendors for payment summaries.
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS materials_purchased text,
  ADD COLUMN IF NOT EXISTS total_amount    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid     numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method  payment_method;

-- ----------------------------------------------------------------------------
-- Material categories table (selectable + creatable on the fly)
-- ----------------------------------------------------------------------------
-- Stores selectable material categories used when recording vendor purchases.
CREATE TABLE IF NOT EXISTS material_categories (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text UNIQUE NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS and revoke direct access on material_categories.
ALTER TABLE material_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON material_categories FROM anon, authenticated;

-- Seed common construction material categories
INSERT INTO material_categories (name) VALUES
  ('TMT Steel'),
  ('Cement'),
  ('Ready Mix Concrete'),
  ('Sand'),
  ('Aggregates'),
  ('Bricks & Blocks'),
  ('Copper Pipes'),
  ('Medical Gas Pipeline'),
  ('Lead Lining'),
  ('HVAC Equipment'),
  ('Fire-rated Doors'),
  ('Vitrified Tiles'),
  ('Electrical & Cabling'),
  ('Plumbing & Sanitary'),
  ('Paints & Coatings'),
  ('Scaffolding'),
  ('Glass & Aluminium'),
  ('Safety Equipment')
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Vendor payments table (individual payment records)
-- ----------------------------------------------------------------------------
-- Stores individual vendor payment records with approver and proof-of-bill.
CREATE TABLE IF NOT EXISTS vendor_payments (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id     uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  amount        numeric NOT NULL CHECK (amount > 0),
  payment_type  payment_method NOT NULL,
  approved_by   uuid NOT NULL REFERENCES users(id),
  proof_path    text NOT NULL,
  payment_date  timestamptz NOT NULL DEFAULT now(),
  notes         text,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
-- Speeds up listing payments for a given vendor.
CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor_id ON vendor_payments(vendor_id);
-- Speeds up listing payments approved by a given user.
CREATE INDEX IF NOT EXISTS idx_vendor_payments_approved_by ON vendor_payments(approved_by);
-- Speeds up sorting payments by date.
CREATE INDEX IF NOT EXISTS idx_vendor_payments_created_at ON vendor_payments(created_at);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
-- Enable RLS and revoke direct access on vendor_payments.
ALTER TABLE vendor_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vendor_payments FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Trigger: auto-update vendor amount_paid / outstanding on payment insert
-- ----------------------------------------------------------------------------
-- Recomputes vendor amount_paid and outstanding_amount when a payment is inserted.
CREATE OR REPLACE FUNCTION update_vendor_payment_totals()
RETURNS trigger AS $$
BEGIN
  UPDATE vendors
    SET
      amount_paid = amount_paid + NEW.amount,
      outstanding_amount = GREATEST(total_amount - (amount_paid + NEW.amount), 0)
    WHERE id = NEW.vendor_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendor_payment_insert ON vendor_payments;
-- Fires after each payment insert to keep vendor totals in sync.
CREATE TRIGGER trg_vendor_payment_insert
  AFTER INSERT ON vendor_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_vendor_payment_totals();
