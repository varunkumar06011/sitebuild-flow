-- ============================================================================
-- Meditrust ERP — Parts Order & Work Order Module
-- ============================================================================
-- Adds two new document workflows:
--   1. Parts Orders  — request materials/parts from vendors (linked to inventory)
--   2. Work Orders   — formal work instructions with cost tracking & supervisor assignment
--
-- Both tables store snapshot columns for historical accuracy (vendor address,
-- customer info, etc. are frozen at creation time).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE parts_order_status AS ENUM ('Draft','Sent','Approved','Ordered','Partially Received','Received','Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE work_order_status AS ENUM ('Draft','Sent','Approved','Assigned','In Progress','Completed','Closed','Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE parts_order_type AS ENUM ('Stock Order','Project Requirement','Emergency Requirement','Replacement','Other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Parts Order sequence (global, never resets — same pattern as pr_global_seq)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parts_order_seq (
  id        int PRIMARY KEY DEFAULT 1,
  last_seq  bigint NOT NULL DEFAULT 0,
  CONSTRAINT parts_order_seq_single_row CHECK (id = 1)
);

INSERT INTO parts_order_seq (id, last_seq) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION next_parts_order_number()
RETURNS text AS $$
DECLARE
  next_seq bigint;
  po_num   text;
BEGIN
  UPDATE parts_order_seq
    SET last_seq = last_seq + 1
    WHERE id = 1
    RETURNING last_seq INTO next_seq;

  po_num := 'PO-' || EXTRACT(YEAR FROM now())::text || '-' || LPAD(next_seq::text, 5, '0');
  RETURN po_num;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE parts_order_seq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parts_order_seq FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Work Order sequence (global, never resets)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_order_seq (
  id        int PRIMARY KEY DEFAULT 1,
  last_seq  bigint NOT NULL DEFAULT 0,
  CONSTRAINT work_order_seq_single_row CHECK (id = 1)
);

INSERT INTO work_order_seq (id, last_seq) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION next_work_order_number()
RETURNS text AS $$
DECLARE
  next_seq bigint;
  wo_num   text;
BEGIN
  UPDATE work_order_seq
    SET last_seq = last_seq + 1
    WHERE id = 1
    RETURNING last_seq INTO next_seq;

  wo_num := 'WO-' || EXTRACT(YEAR FROM now())::text || '-' || LPAD(next_seq::text, 5, '0');
  RETURN wo_num;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE work_order_seq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON work_order_seq FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Parts Orders (main table)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parts_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        text UNIQUE NOT NULL,
  order_date          timestamptz NOT NULL DEFAULT now(),
  status              parts_order_status NOT NULL DEFAULT 'Draft',
  order_type          parts_order_type NOT NULL DEFAULT 'Project Requirement',

  -- Project / site reference
  block_id            uuid REFERENCES progress_blocks(id) ON DELETE SET NULL,
  project_name        text,
  site_address        text,

  -- Vendor snapshot (frozen at creation for historical accuracy)
  vendor_id           uuid REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name         text,
  vendor_phone        text,
  vendor_email        text,
  vendor_address      text,
  vendor_gst          text,

  -- Delivery information
  requested_delivery_date date,
  delivery_address    text,
  delivery_contact    text,
  delivery_phone      text,
  shipping_method     text,
  shipping_account    text,

  -- Requester
  requested_by        uuid NOT NULL REFERENCES users(id),
  requested_by_name   text,
  department          text,

  -- Comments
  comments            text,

  -- Document storage
  pdf_path            text,

  -- Timestamps
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parts_orders_status ON parts_orders(status);
CREATE INDEX IF NOT EXISTS idx_parts_orders_vendor ON parts_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_parts_orders_block ON parts_orders(block_id);
CREATE INDEX IF NOT EXISTS idx_parts_orders_requested_by ON parts_orders(requested_by);
CREATE INDEX IF NOT EXISTS idx_parts_orders_date ON parts_orders(order_date);

-- ----------------------------------------------------------------------------
-- Parts Order Items (line items)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parts_order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parts_order_id  uuid NOT NULL REFERENCES parts_orders(id) ON DELETE CASCADE,
  item_id         uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  item_name       text NOT NULL,
  part_number     text,
  description     text,
  quantity        numeric NOT NULL CHECK (quantity > 0),
  unit            text,
  required_date   date,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parts_order_items_order ON parts_order_items(parts_order_id);
CREATE INDEX IF NOT EXISTS idx_parts_order_items_item ON parts_order_items(item_id);

-- ----------------------------------------------------------------------------
-- Work Orders (main table)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        text UNIQUE NOT NULL,
  order_date          timestamptz NOT NULL DEFAULT now(),
  status              work_order_status NOT NULL DEFAULT 'Draft',

  -- Project / site reference
  block_id            uuid REFERENCES progress_blocks(id) ON DELETE SET NULL,
  project_name        text,
  project_id          text,
  site_name           text,
  site_address        text,

  -- Customer / Bill-To snapshot (frozen at creation)
  customer_name       text,
  customer_id         text,
  customer_contact    text,
  billing_address     text,
  billing_city        text,
  billing_state       text,
  billing_pincode     text,
  customer_phone      text,
  customer_email      text,

  -- Requester
  requested_by        uuid NOT NULL REFERENCES users(id),
  requested_by_name   text,
  department          text,

  -- Supervisor assignment
  assigned_supervisor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_supervisor_name text,
  assigned_at         timestamptz,

  -- Job details
  work_description    text,

  -- Tax / totals
  subtotal            numeric NOT NULL DEFAULT 0,
  taxable_amount      numeric NOT NULL DEFAULT 0,
  tax_rate            numeric NOT NULL DEFAULT 0,
  tax_amount          numeric NOT NULL DEFAULT 0,
  shipping_handling   numeric NOT NULL DEFAULT 0,
  other_charges       numeric NOT NULL DEFAULT 0,
  grand_total         numeric NOT NULL DEFAULT 0,

  -- Payment terms
  payment_terms       text,
  due_date            date,
  advance_amount      numeric NOT NULL DEFAULT 0,
  balance_due         numeric NOT NULL DEFAULT 0,

  -- Comments
  comments            text,

  -- Completion / acknowledgement
  completed_date      date,
  completed_by_name   text,
  customer_acknowledgement text,

  -- Document storage
  pdf_path            text,

  -- Timestamps
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_block ON work_orders(block_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_supervisor ON work_orders(assigned_supervisor_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_requested_by ON work_orders(requested_by);
CREATE INDEX IF NOT EXISTS idx_work_orders_date ON work_orders(order_date);

-- ----------------------------------------------------------------------------
-- Work Order Items (cost / line items)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  description     text NOT NULL,
  quantity        numeric NOT NULL CHECK (quantity > 0),
  taxable         boolean NOT NULL DEFAULT false,
  unit_price      numeric NOT NULL CHECK (unit_price >= 0),
  total           numeric NOT NULL DEFAULT 0,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_order_items_order ON work_order_items(work_order_id);

-- ----------------------------------------------------------------------------
-- RLS — Defense in Depth
-- ----------------------------------------------------------------------------
ALTER TABLE parts_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON parts_orders, parts_order_items, work_orders, work_order_items FROM anon, authenticated;
