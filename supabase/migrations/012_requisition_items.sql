-- ============================================================================
-- Meditrust ERP — Multi-item PR (requisition line items)
-- ============================================================================
-- Allows a PR to have multiple line items (e.g., steel + cement + sand).
-- The requisition.amount becomes the sum of line item amounts (or can be set
-- manually if no line items are used — backward compatible).
-- ============================================================================

CREATE TABLE IF NOT EXISTS requisition_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  requisition_id  uuid NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  description     text NOT NULL,
  quantity        numeric NOT NULL DEFAULT 0,
  unit            text,
  unit_price      numeric NOT NULL DEFAULT 0,
  amount          numeric NOT NULL DEFAULT 0,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_requisition_items_req_id ON requisition_items(requisition_id);

ALTER TABLE requisition_items ENABLE ROW LEVEL SECURITY;
