-- ============================================================================
-- Meditrust ERP — Hospital-Specific Modules
-- ============================================================================
-- Five modules that make this a hospital construction ERP, not a generic one:
--   1. Medical Equipment & Asset Commissioning Tracker
--   2. AERB / Radiation Safety Compliance
--   3. Cleanroom & HVAC Validation Tracker
--   4. Medical Gas Pipeline Tracker
--   5. NABH Pre-Accreditation Checklist
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

-- Medical equipment lifecycle from delivery to clinical handover.
DO $$ BEGIN
  CREATE TYPE equipment_status AS ENUM ('Ordered', 'Delivered', 'Installed', 'Testing', 'Commissioned', 'Handed Over');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AERB shielding inspection outcome.
DO $$ BEGIN
  CREATE TYPE shielding_result AS ENUM ('Pass', 'Fail', 'Re-test');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cleanroom validation test outcome.
DO $$ BEGIN
  CREATE TYPE cleanroom_result AS ENUM ('Pass', 'Fail', 'Re-test');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Medical gas pipeline test outcome.
DO $$ BEGIN
  CREATE TYPE gas_test_result AS ENUM ('Pass', 'Fail', 'Pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NABH checklist item status.
DO $$ BEGIN
  CREATE TYPE nabh_status AS ENUM ('Pending', 'In Progress', 'Completed', 'Not Applicable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 1. Medical Equipment & Asset Commissioning
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS medical_equipment (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  eq_number       text UNIQUE NOT NULL,
  name            text NOT NULL,
  model           text,
  serial_number   text,
  manufacturer    text,
  category        text,
  location        text,
  vendor_id       uuid REFERENCES vendors(id),
  requisition_id  uuid REFERENCES requisitions(id),
  status          equipment_status NOT NULL DEFAULT 'Ordered',
  warranty_start  timestamptz,
  warranty_end    timestamptz,
  amc_expiry      timestamptz,
  handover_date   timestamptz,
  handover_department text,
  commissioning_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  certificates    jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medical_equipment_status ON medical_equipment(status);
CREATE INDEX IF NOT EXISTS idx_medical_equipment_category ON medical_equipment(category);

-- ----------------------------------------------------------------------------
-- 2. AERB / Radiation Safety Compliance
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS aerb_compliance (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  area            text NOT NULL,
  shielding_type  text,
  material        text,
  thickness       text,
  batch_id        uuid REFERENCES batches(id),
  inspection_date timestamptz NOT NULL DEFAULT now(),
  result          shielding_result NOT NULL DEFAULT 'Pass',
  dose_survey_value numeric,
  dose_survey_unit text,
  license_number  text,
  license_expiry  timestamptz,
  notes           text,
  photos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aerb_result ON aerb_compliance(result);
CREATE INDEX IF NOT EXISTS idx_aerb_license_expiry ON aerb_compliance(license_expiry);

-- ----------------------------------------------------------------------------
-- 3. Cleanroom & HVAC Validation
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cleanroom_validation (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  area            text NOT NULL,
  test_type       text NOT NULL,
  iso_class       text,
  particle_count  numeric,
  ach_value       numeric,
  pressure_diff   numeric,
  filter_type     text,
  filter_install_date timestamptz,
  filter_replacement_date timestamptz,
  test_date       timestamptz NOT NULL DEFAULT now(),
  result          cleanroom_result NOT NULL DEFAULT 'Pass',
  notes           text,
  photos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleanroom_result ON cleanroom_validation(result);
CREATE INDEX IF NOT EXISTS idx_cleanroom_area ON cleanroom_validation(area);

-- ----------------------------------------------------------------------------
-- 4. Medical Gas Pipeline Tracker
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS medical_gas_pipeline (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  gas_type        text NOT NULL,
  pipeline_segment text NOT NULL,
  pressure_test_date timestamptz,
  pressure_test_result gas_test_result NOT NULL DEFAULT 'Pending',
  leak_test_date  timestamptz,
  leak_test_result gas_test_result NOT NULL DEFAULT 'Pending',
  manifold_installed boolean NOT NULL DEFAULT false,
  cross_connection_verified boolean NOT NULL DEFAULT false,
  batch_id        uuid REFERENCES batches(id),
  notes           text,
  photos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medical_gas_type ON medical_gas_pipeline(gas_type);

-- ----------------------------------------------------------------------------
-- 5. NABH Pre-Accreditation Checklist
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS nabh_checklist (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  category        text NOT NULL,
  item            text NOT NULL,
  status          nabh_status NOT NULL DEFAULT 'Pending',
  responsible_party text,
  document_path   text,
  expiry_date     timestamptz,
  completed_date  timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nabh_status ON nabh_checklist(status);
CREATE INDEX IF NOT EXISTS idx_nabh_category ON nabh_checklist(category);

-- ----------------------------------------------------------------------------
-- RLS — deny all for anon/authenticated (defense in depth)
-- ----------------------------------------------------------------------------
ALTER TABLE medical_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE aerb_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleanroom_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_gas_pipeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE nabh_checklist ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON medical_equipment, aerb_compliance, cleanroom_validation, medical_gas_pipeline, nabh_checklist FROM anon, authenticated;

-- Allow authenticated users to read (defense-in-depth, same as vendors)
CREATE POLICY "medical_equipment_read_authenticated" ON medical_equipment
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "aerb_read_authenticated" ON aerb_compliance
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "cleanroom_read_authenticated" ON cleanroom_validation
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "medical_gas_read_authenticated" ON medical_gas_pipeline
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "nabh_read_authenticated" ON nabh_checklist
  FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- Seed Data
-- ----------------------------------------------------------------------------

-- Medical Equipment
INSERT INTO medical_equipment (eq_number, name, model, serial_number, manufacturer, category, location, status, warranty_start, warranty_end, commissioning_checklist, certificates) VALUES
  ('EQ/JAN/0001', 'MRI Scanner 1.5T', 'Signa Explorer', 'GE-2024-001', 'GE Healthcare', 'Radiology', 'Radiology · MRI Room', 'Installed', '2026-01-15', '2028-01-15',
    '[{"item":"Electrical safety check","ok":true},{"item":"Cooling system calibration","ok":true},{"item":"Magnetic field homogeneity test","ok":false},{"item":"Radiation safety survey","ok":true}]'::jsonb,
    '[{"type":"AERB","number":"AERB-MRI-2024-001","issued_date":"2026-01-20","expiry_date":"2029-01-20"}]'::jsonb),
  ('EQ/FEB/0002', 'CT Scanner 128-Slice', 'Revolution ACT', 'GE-2024-002', 'GE Healthcare', 'Radiology', 'Radiology · CT Room', 'Testing', '2026-02-01', '2028-02-01',
    '[{"item":"Electrical safety check","ok":true},{"item":"Image quality calibration","ok":true},{"item":"Radiation dose survey","ok":false}]'::jsonb,
    '[]'::jsonb),
  ('EQ/MAR/0003', 'OT Table Electro-Hydraulic', 'MOT-3000', 'MED-2024-003', 'Meditech Systems', 'Surgery', 'OT Block · OT-1', 'Commissioned', '2026-03-10', '2028-03-10',
    '[{"item":"Hydraulic function test","ok":true},{"item":"Control panel test","ok":true},{"item":"Weight capacity test","ok":true}]'::jsonb,
    '[{"type":"NABH","number":"NABH-OT-2024-003","issued_date":"2026-03-15","expiry_date":"2029-03-15"}]'::jsonb)
ON CONFLICT (eq_number) DO NOTHING;

-- AERB Compliance
INSERT INTO aerb_compliance (area, shielding_type, material, thickness, inspection_date, result, dose_survey_value, dose_survey_unit, license_number, license_expiry, notes) VALUES
  ('CT Room', 'Wall', 'Lead lining', '2mm Pb', '2026-02-15', 'Pass', 0.02, 'mSv/hr', 'AERB-CT-2024-001', '2029-02-15', 'All walls within dose limits'),
  ('MRI Room', 'Door', 'Lead-lined door', '3mm Pb', '2026-01-20', 'Pass', 0.01, 'mSv/hr', 'AERB-MRI-2024-001', '2029-01-20', 'Door shielding verified'),
  ('Linear Accelerator Room', 'Wall', 'Concrete + Lead', '2.5mm Pb equivalent', '2026-04-01', 'Re-test', 0.15, 'mSv/hr', NULL, NULL, 'Dose at control panel exceeds threshold — re-test after additional shielding')
ON CONFLICT DO NOTHING;

-- Cleanroom Validation
INSERT INTO cleanroom_validation (area, test_type, iso_class, particle_count, ach_value, pressure_diff, filter_type, filter_install_date, test_date, result, notes) VALUES
  ('OT-1', 'Particle Count', 'ISO Class 5', 3520, NULL, NULL, 'HEPA H14', '2026-01-10', '2026-02-01', 'Pass', 'Within ISO Class 5 limits at rest'),
  ('OT-1', 'Air Change Rate', NULL, NULL, 25, NULL, NULL, NULL, '2026-02-01', 'Pass', 'ACH meets NABH minimum of 20'),
  ('ICU', 'Pressure Differential', NULL, NULL, NULL, 8, NULL, NULL, '2026-02-05', 'Pass', 'Positive pressure maintained at 8 Pa'),
  ('Lab', 'Particle Count', 'ISO Class 7', 352000, NULL, NULL, 'HEPA H13', '2026-01-15', '2026-02-10', 'Fail', 'Particle count exceeds ISO Class 7 — filter replacement needed')
ON CONFLICT DO NOTHING;

-- Medical Gas Pipeline
INSERT INTO medical_gas_pipeline (gas_type, pipeline_segment, pressure_test_date, pressure_test_result, leak_test_date, leak_test_result, manifold_installed, cross_connection_verified, notes) VALUES
  ('Oxygen', 'Main to OT Block', '2026-01-20', 'Pass', '2026-01-22', 'Pass', true, true, 'All tests passed'),
  ('Oxygen', 'Main to ICU', '2026-01-25', 'Pass', '2026-01-27', 'Pass', true, true, NULL),
  ('Medical Air', 'Main to OT Block', '2026-02-01', 'Pass', '2026-02-03', 'Pending', true, false, 'Leak test pending'),
  ('Vacuum', 'Main to Wards', '2026-02-10', 'Pending', NULL, 'Pending', false, false, 'Pipeline installation in progress'),
  ('Nitrous Oxide', 'Main to OT-1', '2026-02-15', 'Pass', '2026-02-17', 'Pass', true, true, 'Cross-connection verified by third-party inspector')
ON CONFLICT DO NOTHING;

-- NABH Checklist
INSERT INTO nabh_checklist (category, item, status, responsible_party, notes) VALUES
  ('Fire Safety', 'NOC from Fire Department', 'Completed', 'Civil Team', 'NOC obtained valid till 2029'),
  ('Fire Safety', 'Fire alarm system commissioning', 'In Progress', 'MEP Contractor', 'Commissioning in progress'),
  ('Electrical Safety', 'IS 732 compliance verification', 'Completed', 'Electrical Consultant', 'Verified by third-party'),
  ('Electrical Safety', 'Earthing resistance test', 'Pending', 'Electrical Contractor', NULL),
  ('Bio-medical Waste', 'Segregation rooms construction', 'Completed', 'Civil Team', '4 segregation rooms built as per color coding'),
  ('Bio-medical Waste', 'Waste treatment area setup', 'In Progress', 'MEP Contractor', NULL),
  ('Accessibility', 'Ramp installation at main entrance', 'Completed', 'Civil Team', '1:12 slope ratio maintained'),
  ('Accessibility', 'Tactile flooring for visually impaired', 'Pending', 'Civil Contractor', NULL),
  ('Infrastructure', 'Signage installation (bilingual)', 'In Progress', 'Interior Contractor', NULL),
  ('Infrastructure', 'Emergency exit signage (illuminated)', 'Pending', 'MEP Contractor', NULL)
ON CONFLICT DO NOTHING;
