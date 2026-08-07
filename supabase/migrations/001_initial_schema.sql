-- ============================================================================
-- Meditrust ERP — Initial Schema Migration
-- ============================================================================
-- Creates all tables, enums, indexes, triggers, RLS (deny-all), and seed data
-- for the Hospital Construction ERP production system.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('Supervisor', 'Administrator', 'A1', 'A1+');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE procurement_stage AS ENUM ('PR', 'Quotation', 'Admin', 'A1', 'PO', 'Material Received', 'Invoice', 'Payment', 'Completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gate_pass_status AS ENUM ('Awaiting OTP', 'OTP Verified', 'Exited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gate_pass_type AS ENUM ('Returnable', 'Non-returnable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE otp_channel AS ENUM ('sms', 'in_app');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE batch_status AS ENUM ('Verified', 'Pending MTC', 'Under Test');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inspection_result AS ENUM ('Pass', 'Fail', 'Re-inspection');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- Users (custom auth — not Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  username    text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role        user_role NOT NULL,
  name        text NOT NULL,
  phone       text,
  failed_login_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Sessions (JWT revocation)
CREATE TABLE IF NOT EXISTS sessions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Organization settings (single row — issuer details for documents)
CREATE TABLE IF NOT EXISTS organization_settings (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  gst_number  text,
  address     text,
  city        text,
  state       text,
  pincode     text,
  phone       text,
  email       text,
  logo_url    text
);

-- Vendors / contractors
CREATE TABLE IF NOT EXISTS vendors (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  gst_number  text,
  address     text,
  city        text,
  state       text,
  pincode     text,
  phone       text,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Requisitions (procurement pipeline)
CREATE TABLE IF NOT EXISTS requisitions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pr_number   text UNIQUE NOT NULL,
  title       text NOT NULL,
  block       text,
  vendor_id   uuid REFERENCES vendors(id),
  amount      numeric NOT NULL DEFAULT 0,
  stage       procurement_stage NOT NULL DEFAULT 'PR',
  raised_by   uuid NOT NULL REFERENCES users(id),
  date        timestamptz NOT NULL DEFAULT now(),
  quotations  jsonb NOT NULL DEFAULT '[]'::jsonb,
  documents   jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- Gate passes (material exit with OTP)
CREATE TABLE IF NOT EXISTS gate_passes (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  gp_number       text UNIQUE NOT NULL,
  material        text NOT NULL,
  qty             text NOT NULL,
  carrier         text,
  vehicle         text,
  type            gate_pass_type NOT NULL DEFAULT 'Non-returnable',
  status          gate_pass_status NOT NULL DEFAULT 'Awaiting OTP',
  otp_hash        text,
  otp_expires_at  timestamptz,
  otp_attempts    int NOT NULL DEFAULT 0,
  otp_locked      boolean NOT NULL DEFAULT false,
  approver_phone  text,
  otp_channel     otp_channel,
  requested_by    uuid NOT NULL REFERENCES users(id),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  exit_time       timestamptz,
  approved_by     uuid REFERENCES users(id),
  vendor_id       uuid REFERENCES vendors(id),
  from_location   text,
  to_location     text,
  invoice_number  text,
  invoice_value   numeric,
  purpose         text,
  pdf_path        text
);

-- Batches (material traceability)
CREATE TABLE IF NOT EXISTS batches (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_number  text UNIQUE NOT NULL,
  material      text NOT NULL,
  supplier      text,
  manufacturer  text,
  purchase_date timestamptz,
  invoice       text,
  challan       text,
  mtc           text,
  lab_report    text,
  photos        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        batch_status NOT NULL DEFAULT 'Pending MTC'
);

-- Inspections (quality control)
CREATE TABLE IF NOT EXISTS inspections (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  qc_number     text UNIQUE NOT NULL,
  activity      text NOT NULL,
  location      text,
  inspector     text,
  date          timestamptz NOT NULL DEFAULT now(),
  result        inspection_result NOT NULL DEFAULT 'Pass',
  checklist     jsonb NOT NULL DEFAULT '[]'::jsonb,
  rectification text,
  photos        jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- Visitors register
CREATE TABLE IF NOT EXISTS visitors (
  id      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name    text NOT NULL,
  org     text,
  purpose text,
  in_time timestamptz NOT NULL DEFAULT now(),
  out_time timestamptz,
  host    text
);

-- Vehicles register
CREATE TABLE IF NOT EXISTS vehicles (
  id      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  number  text NOT NULL,
  type    text,
  driver  text,
  material text,
  in_time timestamptz NOT NULL DEFAULT now(),
  out_time timestamptz
);

-- Labour attendance
CREATE TABLE IF NOT EXISTS labour (
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade     text NOT NULL,
  contractor text,
  planned   int NOT NULL DEFAULT 0,
  present   int NOT NULL DEFAULT 0,
  block     text,
  date      timestamptz NOT NULL DEFAULT now()
);

-- Block progress
CREATE TABLE IF NOT EXISTS progress (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  block       text NOT NULL,
  pct         numeric NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Notifications (in-app OTP fallback & alerts)
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Audit log (immutable — enforced by trigger)
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid REFERENCES users(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Gate pass sequences (monthly counter for GP/MON/0001)
CREATE TABLE IF NOT EXISTS gate_pass_sequences (
  id      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  year    int NOT NULL,
  month   text NOT NULL,
  last_seq int NOT NULL DEFAULT 0,
  UNIQUE(year, month)
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_requisitions_stage ON requisitions(stage);
CREATE INDEX IF NOT EXISTS idx_requisitions_raised_by ON requisitions(raised_by);
CREATE INDEX IF NOT EXISTS idx_gate_passes_requested_by ON gate_passes(requested_by);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_revoked ON sessions(user_id, revoked);

-- ----------------------------------------------------------------------------
-- Audit log immutability trigger
-- Prevents UPDATE and DELETE regardless of role (including service_role)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION raise_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable — UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION raise_immutable();

-- ----------------------------------------------------------------------------
-- Gate pass sequence function (atomic increment)
-- Returns the next gp_number in format GP/MON/0001
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_gp_number()
RETURNS text AS $$
DECLARE
  current_year int := EXTRACT(YEAR FROM now());
  current_month text := UPPER(SUBSTR(TO_CHAR(now(), 'Mon'), 1, 3));
  next_seq int;
  gp_num text;
BEGIN
  INSERT INTO gate_pass_sequences (year, month, last_seq)
    VALUES (current_year, current_month, 1)
    ON CONFLICT (year, month) DO UPDATE
    SET last_seq = gate_pass_sequences.last_seq + 1
    RETURNING last_seq INTO next_seq;

  gp_num := 'GP/' || current_month || '/' || LPAD(next_seq::text, 4, '0');
  RETURN gp_num;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- RLS — Defense in Depth (deny all for anon/authenticated)
-- All access goes through server functions using service_role key
-- ----------------------------------------------------------------------------
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_pass_sequences ENABLE ROW LEVEL SECURITY;

-- Revoke all privileges from anon and authenticated roles
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- No policies are created — service_role bypasses RLS by default
-- and all authorization is enforced in application server functions

-- ----------------------------------------------------------------------------
-- Seed Data
-- ----------------------------------------------------------------------------

-- Organization settings (single row — edit later)
INSERT INTO organization_settings (name, gst_number, address, city, state, pincode, phone, email)
VALUES (
  'Meditrust Hospitals',
  '33AAAAA0000A1Z5',
  'Plot 1, Medical Park, OMR',
  'Chennai',
  'Tamil Nadu',
  '600001',
  '+914400000000',
  'admin@meditrust.in'
)
ON CONFLICT DO NOTHING;

-- Users (passwords hashed with bcrypt cost 12 via pgcrypto crypt())
-- These hashes are compatible with bcryptjs compare()
INSERT INTO users (username, password_hash, role, name, phone) VALUES
  ('supervisor', crypt('site123', gen_salt('bf', 12)), 'Supervisor', 'R. Kannan', '+919876543210'),
  ('admin',      crypt('admin123', gen_salt('bf', 12)), 'Administrator', 'V. Sharma', '+919876543211'),
  ('a1',         crypt('a1pass123', gen_salt('bf', 12)), 'A1', 'M. Iyer', '+919876543212'),
  ('a1plus',     crypt('final123', gen_salt('bf', 12)), 'A1+', 'K. Reddy', '+919876543213')
ON CONFLICT (username) DO NOTHING;

-- Vendors
INSERT INTO vendors (name, gst_number, address, city, state, pincode, phone, email) VALUES
  ('Meenakshi Steels', '33AAACM1234A1Z5', 'Industrial Estate, Guindy', 'Chennai', 'Tamil Nadu', '600032', '+914422334455', 'sales@meenakshisteels.in'),
  ('Aeromed Systems', '29AAACA5678B1Z9', 'Whitefield Industrial Area', 'Bengaluru', 'Karnataka', '560066', '+918022334455', 'info@aeromedsys.in'),
  ('Shield Radiation Products', '07AAACS9012C1Z3', 'Sector 18, Vashi', 'Navi Mumbai', 'Maharashtra', '400703', '+912266778899', 'contact@shieldrad.in'),
  ('Nirmala Ceramics', '33AAACN3456D1Z7', 'Ambattur Industrial Estate', 'Chennai', 'Tamil Nadu', '600058', '+914426374855', 'orders@nirmalaceramics.in'),
  ('Thermoline Engineers', '27AAACT7890E1Z1', 'MIDC Bhosari', 'Pune', 'Maharashtra', '411026', '+912026334455', 'projects@thermoline.in'),
  ('Safeguard Doors', '33AAACS2345F1Z8', 'Sipcot Industrial Complex', 'Chennai', 'Tamil Nadu', '600064', '+914423344556', 'sales@safeguarddoors.in'),
  ('Sree Ganesh Metals', '33AAACG6789G1Z2', 'Pallavaram Industrial Estate', 'Chennai', 'Tamil Nadu', '600043', '+914428374657', 'info@sreeganeshmetals.in'),
  ('Coastal RMC', '33AAACC1234H1Z6', 'Ennore Port Road', 'Chennai', 'Tamil Nadu', '600057', '+914429374857', 'dispatch@coastalrmc.in')
ON CONFLICT DO NOTHING;

-- Requisitions (procurement pipeline)
-- Using fixed UUIDs for raised_by references
DO $$
DECLARE
  supervisor_id uuid := (SELECT id FROM users WHERE username = 'supervisor');
  admin_id uuid := (SELECT id FROM users WHERE username = 'admin');
  v_meenakshi uuid := (SELECT id FROM vendors WHERE name = 'Meenakshi Steels');
  v_aeromed uuid := (SELECT id FROM vendors WHERE name = 'Aeromed Systems');
  v_shield uuid := (SELECT id FROM vendors WHERE name = 'Shield Radiation Products');
  v_nirmala uuid := (SELECT id FROM vendors WHERE name = 'Nirmala Ceramics');
  v_thermoline uuid := (SELECT id FROM vendors WHERE name = 'Thermoline Engineers');
  v_safeguard uuid := (SELECT id FROM vendors WHERE name = 'Safeguard Doors');
BEGIN
  INSERT INTO requisitions (pr_number, title, block, vendor_id, amount, stage, raised_by, date, quotations, documents) VALUES
    ('PR-2041', 'TMT Steel Fe550D — 24 T', 'OT Block · Level 3', v_meenakshi, 1840000, 'A1', supervisor_id, '2026-08-04 09:00:00+05:30',
     '[{"vendor":"Meenakshi Steels","amount":1840000,"selected":true},{"vendor":"Sree Ganesh Metals","amount":1892000,"selected":false},{"vendor":"Coastal Iron Co.","amount":1935500,"selected":false}]'::jsonb,
     '["PR-2041.pdf","Quote-MS-881.pdf","Quote-SG-104.pdf"]'::jsonb),

    ('PR-2038', 'Medical Gas Copper Pipeline — 400 m', 'ICU Wing · Level 2', v_aeromed, 642000, 'PO', supervisor_id, '2026-08-02 09:00:00+05:30',
     '[{"vendor":"Aeromed Systems","amount":642000,"selected":true},{"vendor":"Vitalflow Pvt Ltd","amount":668000,"selected":false}]'::jsonb,
     '["PR-2038.pdf","PO-7712.pdf"]'::jsonb),

    ('PR-2036', 'Lead Lining Sheets — Radiology', 'Diagnostics · Level 1', v_shield, 386000, 'Material Received', supervisor_id, '2026-07-31 09:00:00+05:30',
     '[{"vendor":"Shield Radiation Products","amount":386000,"selected":true}]'::jsonb,
     '["PR-2036.pdf","PO-7698.pdf","DC-4471.pdf","MTC-Pb-22.pdf"]'::jsonb),

    ('PR-2033', 'Vitrified Anti-skid Flooring — 1,200 sqm', 'OPD Block · Ground', v_nirmala, 48500, 'Admin', supervisor_id, '2026-07-30 09:00:00+05:30',
     '[{"vendor":"Nirmala Ceramics","amount":48500,"selected":true},{"vendor":"Tilecraft India","amount":51200,"selected":false}]'::jsonb,
     '["PR-2033.pdf"]'::jsonb),

    ('PR-2029', 'HVAC AHU Units (4 Nos) — Modular OT', 'OT Block · Level 3', v_thermoline, 2960000, 'Invoice', supervisor_id, '2026-07-26 09:00:00+05:30',
     '[{"vendor":"Thermoline Engineers","amount":2960000,"selected":true},{"vendor":"Blue Arc Climate","amount":3110000,"selected":false}]'::jsonb,
     '["PR-2029.pdf","PO-7654.pdf","INV-9921.pdf"]'::jsonb),

    ('PR-2024', 'Fire-rated Doors (18 Nos)', 'ICU Wing · Level 2', v_safeguard, 415000, 'Completed', supervisor_id, '2026-07-18 09:00:00+05:30',
     '[{"vendor":"Safeguard Doors","amount":415000,"selected":true}]'::jsonb,
     '["PR-2024.pdf","PO-7601.pdf","INV-9840.pdf","PAY-3312.pdf"]'::jsonb)
  ON CONFLICT (pr_number) DO NOTHING;
END $$;

-- Gate passes (seed with historical data — no OTP hash for seed data)
DO $$
DECLARE
  supervisor_id uuid := (SELECT id FROM users WHERE username = 'supervisor');
  admin_id uuid := (SELECT id FROM users WHERE username = 'admin');
BEGIN
  INSERT INTO gate_passes (gp_number, material, qty, carrier, vehicle, type, status, approver_phone, otp_channel, requested_by, requested_at, exit_time, approved_by, from_location, to_location, purpose) VALUES
    ('GP/AUG/0001', 'Scaffolding frames (surplus)', '120 nos', 'Ravi Transport', 'TN-09-CQ-4412', 'Returnable', 'Awaiting OTP', '+919876543211', 'in_app', supervisor_id, '2026-08-06 09:12:00+05:30', NULL, NULL, 'OT Block · Level 3', 'Ravi Transport Yard', 'Return surplus scaffolding'),
    ('GP/AUG/0002', 'Empty cement bags', '3 bundles', 'Site Housekeeping', 'TN-07-BA-1180', 'Non-returnable', 'OTP Verified', '+919876543211', 'in_app', supervisor_id, '2026-08-06 08:40:00+05:30', NULL, admin_id, 'OPD Block · Ground', 'Waste Disposal Facility', 'Dispose of empty cement bags'),
    ('GP/JUL/0001', 'Damaged AHU coil (RMA)', '1 unit', 'Thermoline Engineers', 'KA-05-MJ-7781', 'Returnable', 'Exited', '+919876543212', 'in_app', supervisor_id, '2026-08-05 16:05:00+05:30', '2026-08-05 17:22:00+05:30', admin_id, 'OT Block · Level 3', 'Thermoline Factory Pune', 'Return damaged coil for RMA')
  ON CONFLICT (gp_number) DO NOTHING;

  -- Update sequence counter to match seed data
  INSERT INTO gate_pass_sequences (year, month, last_seq) VALUES
    (2026, 'AUG', 2),
    (2026, 'JUL', 1)
  ON CONFLICT (year, month) DO UPDATE SET last_seq = EXCLUDED.last_seq;
END $$;

-- Batches (material traceability)
INSERT INTO batches (batch_number, material, supplier, manufacturer, purchase_date, invoice, challan, mtc, lab_report, photos, status) VALUES
  ('BCH-5521', 'TMT Steel Fe550D 16mm', 'Meenakshi Steels', 'JSW Steel Ltd', '2026-08-04 09:00:00+05:30', 'INV-9955', 'DC-4488', 'MTC-JSW-77321', 'LAB-TN-1120 (Pass)', '[]'::jsonb, 'Verified'),
  ('BCH-5518', 'OPC 53 Grade Cement', 'Southern Cement Depot', 'UltraTech', '2026-08-02 09:00:00+05:30', 'INV-9940', 'DC-4471', 'MTC-UT-55110', 'LAB-TN-1114 (Pass)', '[]'::jsonb, 'Verified'),
  ('BCH-5510', 'Lead Sheet 2mm (Radiology)', 'Shield Radiation Products', 'Shield Metals', '2026-07-31 09:00:00+05:30', 'INV-9918', 'DC-4460', 'Awaiting upload', 'Sample sent 01 Aug', '[]'::jsonb, 'Pending MTC'),
  ('BCH-5504', 'M30 Ready Mix Concrete', 'Coastal RMC', 'Coastal RMC Plant 2', '2026-07-28 09:00:00+05:30', 'INV-9902', 'DC-4442', 'MTC-CR-2201', 'Cube test day-7 in progress', '[]'::jsonb, 'Under Test')
ON CONFLICT (batch_number) DO NOTHING;

-- Inspections (quality control)
INSERT INTO inspections (qc_number, activity, location, inspector, date, result, checklist, rectification, photos) VALUES
  ('QC-3312', 'Slab reinforcement before pour', 'OT Block · Level 3', 'A. Iyer (QA/QC)', '2026-08-05 09:00:00+05:30', 'Pass',
   '[{"item":"Bar diameter & spacing as per drawing","ok":true},{"item":"Cover blocks placed at 1m grid","ok":true},{"item":"Lap length ≥ 50d","ok":true},{"item":"Shuttering alignment & props","ok":true}]'::jsonb,
   NULL, '[]'::jsonb),
  ('QC-3309', 'Medical gas pipeline pressure test', 'ICU Wing · Level 2', 'M. Rahman (MEP)', '2026-08-04 09:00:00+05:30', 'Fail',
   '[{"item":"Brazed joints nitrogen purged","ok":true},{"item":"Holds 7 bar for 24 hrs","ok":false},{"item":"Line labelling & colour coding","ok":true},{"item":"Valve box accessibility","ok":false}]'::jsonb,
   'Re-braze joints J-14/J-15, relocate valve box. Due 08 Aug.', '[]'::jsonb),
  ('QC-3301', 'Radiology lead lining continuity', 'Diagnostics · Level 1', 'A. Iyer (QA/QC)', '2026-08-02 09:00:00+05:30', 'Re-inspection',
   '[{"item":"Overlap ≥ 10mm at all seams","ok":true},{"item":"No pinholes on scan","ok":false},{"item":"Door frame shielding continuous","ok":true},{"item":"Certificate matches batch","ok":true}]'::jsonb,
   'Patch 3 pinholes near duct penetration. Re-scan scheduled 07 Aug.', '[]'::jsonb)
ON CONFLICT (qc_number) DO NOTHING;

-- Visitors
INSERT INTO visitors (name, org, purpose, in_time, out_time, host) VALUES
  ('Dr. Meera Nair', 'Client — Medical Planning', 'OT layout walkthrough', '2026-08-06 09:05:00+05:30', '2026-08-06 10:40:00+05:30', 'S. Fernandes'),
  ('Anand Kulkarni', 'Thermoline Engineers', 'AHU installation survey', '2026-08-06 10:20:00+05:30', NULL, 'R. Kannan'),
  ('Insp. Devaraj', 'Fire & Rescue Dept', 'Statutory inspection', '2026-08-06 11:15:00+05:30', NULL, 'P. Deshmukh')
ON CONFLICT DO NOTHING;

-- Vehicles
INSERT INTO vehicles (number, type, driver, material, in_time, out_time) VALUES
  ('TN-09-CQ-4412', 'Truck 16T', 'Ravi S.', 'TMT Steel — 24 T', '2026-08-06 07:48:00+05:30', '2026-08-06 09:30:00+05:30'),
  ('KA-05-MJ-7781', 'Tempo', 'Imran K.', 'AHU coil return', '2026-08-06 08:15:00+05:30', NULL),
  ('TN-22-AL-9002', 'Transit Mixer', 'Suresh M.', 'M30 RMC — 6 cum', '2026-08-06 09:02:00+05:30', NULL)
ON CONFLICT DO NOTHING;

-- Labour attendance
INSERT INTO labour (trade, contractor, planned, present, block, date) VALUES
  ('Steel fixers', 'Balaji Enterprises', 42, 38, 'OT Block', '2026-08-06 08:00:00+05:30'),
  ('Masons', 'Balaji Enterprises', 30, 30, 'OPD Block', '2026-08-06 08:00:00+05:30'),
  ('MEP technicians', 'Aeromed Systems', 18, 14, 'ICU Wing', '2026-08-06 08:00:00+05:30'),
  ('Helpers', 'Site Direct', 55, 51, 'All blocks', '2026-08-06 08:00:00+05:30'),
  ('Safety marshals', 'Site Direct', 6, 6, 'All blocks', '2026-08-06 08:00:00+05:30')
ON CONFLICT DO NOTHING;

-- Block progress
INSERT INTO progress (block, pct, updated_at) VALUES
  ('OT Block', 62, '2026-08-06 08:00:00+05:30'),
  ('ICU Wing', 48, '2026-08-06 08:00:00+05:30'),
  ('OPD Block', 81, '2026-08-06 08:00:00+05:30'),
  ('Diagnostics', 35, '2026-08-06 08:00:00+05:30')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Storage Buckets (private — no public access)
-- These need to be created via Supabase Dashboard or Storage API
-- Documented here for reference:
--   documents (private) — PDFs, quotations, POs, invoices, MTCs, lab reports
--   photos (private) — Site photos for batches, inspections
-- ----------------------------------------------------------------------------
