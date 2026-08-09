-- ============================================================================
-- Meditrust ERP — Six New Modules Migration
-- ============================================================================
-- Creates tables for: labour_attendance, drawings, rfis, punch_items,
-- safety_incidents, sync_queue. Each table follows the same RLS deny-all
-- pattern used by existing tables — all access goes through server functions
-- using the service_role key.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- labour_attendance — daily headcount tracking by work category & contractor
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labour_attendance (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  date                 date NOT NULL DEFAULT CURRENT_DATE,
  work_category        text NOT NULL DEFAULT 'uncategorized',
  contractor_name      text NOT NULL,
  headcount_skilled    int NOT NULL DEFAULT 0,
  headcount_unskilled  int NOT NULL DEFAULT 0,
  marked_by            uuid NOT NULL REFERENCES users(id),
  marked_by_name       text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_labour_attendance_date ON labour_attendance(date);
CREATE INDEX IF NOT EXISTS idx_labour_attendance_work_category ON labour_attendance(work_category);
CREATE INDEX IF NOT EXISTS idx_labour_attendance_contractor ON labour_attendance(contractor_name);
CREATE INDEX IF NOT EXISTS idx_labour_attendance_marked_by ON labour_attendance(marked_by);

ALTER TABLE labour_attendance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON labour_attendance FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- drawings — engineering drawing register with revision tracking
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drawings (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  drawing_no   text UNIQUE NOT NULL,
  title        text NOT NULL,
  discipline   text,
  revision     text NOT NULL DEFAULT 'R0',
  file_path    text NOT NULL,
  uploaded_by  uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drawings_drawing_no ON drawings(drawing_no);
CREATE INDEX IF NOT EXISTS idx_drawings_discipline ON drawings(discipline);
CREATE INDEX IF NOT EXISTS idx_drawings_uploaded_by ON drawings(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_drawings_created ON drawings(created_at);

ALTER TABLE drawings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON drawings FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- rfis — Requests for Information linked to drawings
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE rfi_status AS ENUM ('Open', 'Answered', 'Closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS rfis (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rfi_no         text UNIQUE NOT NULL,
  drawing_id     uuid REFERENCES drawings(id) ON DELETE SET NULL,
  raised_by      uuid NOT NULL REFERENCES users(id),
  raised_by_name text,
  question       text NOT NULL,
  status         rfi_status NOT NULL DEFAULT 'Open',
  response       text,
  responded_by   uuid REFERENCES users(id),
  responded_at   timestamptz,
  sla_due_date   date,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfis_rfi_no ON rfis(rfi_no);
CREATE INDEX IF NOT EXISTS idx_rfis_drawing_id ON rfis(drawing_id);
CREATE INDEX IF NOT EXISTS idx_rfis_status ON rfis(status);
CREATE INDEX IF NOT EXISTS idx_rfis_raised_by ON rfis(raised_by);
CREATE INDEX IF NOT EXISTS idx_rfis_created ON rfis(created_at);

ALTER TABLE rfis ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rfis FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- punch_items — snag / punch list for handover tracking
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE punch_status AS ENUM ('Open', 'In Progress', 'Resolved', 'Verified');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE punch_severity AS ENUM ('Low', 'Medium', 'High', 'Critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS punch_items (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone               text NOT NULL,
  room               text,
  description        text NOT NULL,
  photo_path         text,
  raised_by          uuid NOT NULL REFERENCES users(id),
  assigned_vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  status             punch_status NOT NULL DEFAULT 'Open',
  severity           punch_severity NOT NULL DEFAULT 'Medium',
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_punch_items_zone ON punch_items(zone);
CREATE INDEX IF NOT EXISTS idx_punch_items_status ON punch_items(status);
CREATE INDEX IF NOT EXISTS idx_punch_items_severity ON punch_items(severity);
CREATE INDEX IF NOT EXISTS idx_punch_items_raised_by ON punch_items(raised_by);
CREATE INDEX IF NOT EXISTS idx_punch_items_vendor ON punch_items(assigned_vendor_id);
CREATE INDEX IF NOT EXISTS idx_punch_items_created ON punch_items(created_at);

ALTER TABLE punch_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON punch_items FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- safety_incidents — incident / near-miss reporting
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE safety_incident_type AS ENUM ('Incident', 'Near-miss');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE safety_severity AS ENUM ('Low', 'Medium', 'High', 'Critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS safety_incidents (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type                safety_incident_type NOT NULL DEFAULT 'Incident',
  zone                text,
  contractor_name     text,
  description         text NOT NULL,
  photo_path          text,
  severity            safety_severity NOT NULL DEFAULT 'Medium',
  reported_by         uuid NOT NULL REFERENCES users(id),
  reported_by_name    text,
  status              text NOT NULL DEFAULT 'Open',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_incidents_type ON safety_incidents(type);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_zone ON safety_incidents(zone);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_contractor ON safety_incidents(contractor_name);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_severity ON safety_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_status ON safety_incidents(status);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_reported_by ON safety_incidents(reported_by);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_created ON safety_incidents(created_at);

ALTER TABLE safety_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON safety_incidents FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- sync_queue — generic offline write queue for replay when online
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE sync_status AS ENUM ('Pending', 'Processing', 'Synced', 'Failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sync_queue (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid NOT NULL REFERENCES users(id),
  device_id   text,
  synced_at   timestamptz,
  status      sync_status NOT NULL DEFAULT 'Pending',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_entity_type ON sync_queue(entity_type);
CREATE INDEX IF NOT EXISTS idx_sync_queue_created_by ON sync_queue(created_by);
CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);

ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sync_queue FROM anon, authenticated;
