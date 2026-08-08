-- ============================================================================
-- Meditrust ERP — Finance Modules
-- ============================================================================
-- Four finance modules for hospital construction:
--   1. Budget vs Actual — project budgets by block/category with variance
--   2. TDS / GST Compliance — tax deduction and input credit tracking
--   3. Retention Money — retention held per vendor with release schedule
--   (Cash Flow Forecast is computed from existing requisitions + vendor_payments)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Budget — project budgets by block or category
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS budgets (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  block       text,
  category    text,
  description text NOT NULL,
  budgeted_amount numeric NOT NULL DEFAULT 0,
  fiscal_year text NOT NULL DEFAULT TO_CHAR(now(), 'YYYY'),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_scope CHECK (block IS NOT NULL OR category IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_budgets_block ON budgets(block);
CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets(category);
CREATE INDEX IF NOT EXISTS idx_budgets_fiscal_year ON budgets(fiscal_year);

-- ----------------------------------------------------------------------------
-- 2. TDS / GST Compliance — tax records per vendor payment
-- ----------------------------------------------------------------------------

-- TDS section enum (common construction TDS sections).
DO $$ BEGIN
  CREATE TYPE tds_section AS ENUM ('194C', '194J', '194Q', '194I', 'Other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tds_gst_records (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id       uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  vendor_payment_id uuid REFERENCES vendor_payments(id) ON DELETE SET NULL,
  record_type     text NOT NULL CHECK (record_type IN ('TDS', 'GST')),
  invoice_number  text,
  invoice_amount  numeric NOT NULL DEFAULT 0,
  tds_section     tds_section,
  tds_rate        numeric,
  tds_amount      numeric NOT NULL DEFAULT 0,
  gst_rate        numeric,
  gst_input_credit numeric NOT NULL DEFAULT 0,
  eway_bill_number text,
  eway_bill_date  timestamptz,
  period          text NOT NULL,
  status          text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Filed', 'Reconciled')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tds_gst_vendor ON tds_gst_records(vendor_id);
CREATE INDEX IF NOT EXISTS idx_tds_gst_type ON tds_gst_records(record_type);
CREATE INDEX IF NOT EXISTS idx_tds_gst_status ON tds_gst_records(status);
CREATE INDEX IF NOT EXISTS idx_tds_gst_period ON tds_gst_records(period);

-- ----------------------------------------------------------------------------
-- 3. Retention Money — retention held per vendor/contract
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS retention_records (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id           uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  contract_ref        text,
  total_contract_value numeric NOT NULL DEFAULT 0,
  retention_percentage numeric NOT NULL DEFAULT 5 CHECK (retention_percentage >= 0 AND retention_percentage <= 100),
  retention_held      numeric NOT NULL DEFAULT 0,
  retention_released  numeric NOT NULL DEFAULT 0,
  defect_liability_start timestamptz,
  defect_liability_end   timestamptz,
  release_status      text NOT NULL DEFAULT 'Held' CHECK (release_status IN ('Held', 'Eligible', 'Released')),
  released_date       timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retention_vendor ON retention_records(vendor_id);
CREATE INDEX IF NOT EXISTS idx_retention_status ON retention_records(release_status);
CREATE INDEX IF NOT EXISTS idx_retention_dlp_end ON retention_records(defect_liability_end);

-- ----------------------------------------------------------------------------
-- RLS — deny all for anon, read for authenticated (defense in depth)
-- ----------------------------------------------------------------------------
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tds_gst_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON budgets, tds_gst_records, retention_records FROM anon, authenticated;

CREATE POLICY "budgets_read_authenticated" ON budgets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "tds_gst_read_authenticated" ON tds_gst_records
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "retention_read_authenticated" ON retention_records
  FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- Seed Data
-- ----------------------------------------------------------------------------

-- Budgets
INSERT INTO budgets (block, category, description, budgeted_amount, fiscal_year) VALUES
  ('OT Block', 'Civil', 'OT Block civil structure — foundation, walls, slab', 8500000, '2026'),
  ('OT Block', 'MEP', 'OT Block MEP — electrical, HVAC, medical gas', 6200000, '2026'),
  ('OT Block', 'Medical Equipment', 'OT equipment — tables, lights, monitors', 4500000, '2026'),
  ('ICU', 'Civil', 'ICU civil structure', 5200000, '2026'),
  ('ICU', 'MEP', 'ICU MEP — electrical, HVAC, medical gas', 3800000, '2026'),
  ('Radiology', 'Civil', 'Radiology civil with lead shielding', 7100000, '2026'),
  ('Radiology', 'Medical Equipment', 'MRI + CT scanners', 12000000, '2026'),
  ('General', 'Site Infrastructure', 'Roads, drainage, compound wall, landscaping', 3500000, '2026')
ON CONFLICT DO NOTHING;

-- TDS/GST records
DO $$
DECLARE
  v_meenakshi uuid := (SELECT id FROM vendors WHERE name = 'Meenakshi Steels');
  v_aeromed uuid := (SELECT id FROM vendors WHERE name = 'Aeromed Systems');
  v_nirmala uuid := (SELECT id FROM vendors WHERE name = 'Nirmala Ceramics');
BEGIN
  INSERT INTO tds_gst_records (vendor_id, record_type, invoice_number, invoice_amount, tds_section, tds_rate, tds_amount, gst_rate, gst_input_credit, eway_bill_number, eway_bill_date, period, status, notes) VALUES
    (v_meenakshi, 'TDS', 'INV-2024-001', 1840000, '194C', 1.5, 27600, NULL, 0, 'EWB-381000123', '2026-01-20', '2026-Q1', 'Filed', 'TDS deducted at 1.5% u/s 194C'),
    (v_meenakshi, 'GST', 'INV-2024-001', 1840000, NULL, 0, 0, 18, 331200, 'EWB-381000123', '2026-01-20', '2026-Q1', 'Reconciled', 'GST input credit 18% on steel'),
    (v_aeromed, 'TDS', 'INV-AM-2024-002', 920000, '194C', 2.0, 18400, NULL, 0, NULL, NULL, '2026-Q1', 'Pending', 'TDS at 2% for works contract'),
    (v_nirmala, 'GST', 'INV-NC-2024-003', 480000, NULL, 0, 0, 28, 134400, 'EWB-381000456', '2026-02-10', '2026-Q1', 'Pending', 'GST input credit 28% on ceramics')
  ON CONFLICT DO NOTHING;
END $$;

-- Retention records
DO $$
DECLARE
  v_meenakshi uuid := (SELECT id FROM vendors WHERE name = 'Meenakshi Steels');
  v_aeromed uuid := (SELECT id FROM vendors WHERE name = 'Aeromed Systems');
  v_thermoline uuid := (SELECT id FROM vendors WHERE name = 'Thermoline Engineers');
BEGIN
  INSERT INTO retention_records (vendor_id, contract_ref, total_contract_value, retention_percentage, retention_held, retention_released, defect_liability_start, defect_liability_end, release_status, notes) VALUES
    (v_meenakshi, 'CON/2026/001', 1840000, 5, 92000, 0, '2026-01-20', '2027-01-20', 'Held', '5% retention on steel supply'),
    (v_aeromed, 'CON/2026/002', 920000, 10, 92000, 0, '2026-02-01', '2027-02-01', 'Held', '10% retention on equipment installation'),
    (v_thermoline, 'CON/2026/003', 560000, 5, 28000, 28000, '2025-06-01', '2026-06-01', 'Released', 'Retention released after DLP expiry')
  ON CONFLICT DO NOTHING;
END $$;
