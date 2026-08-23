-- ============================================================================
-- Meditrust ERP — Procurement Receiving Integration
-- Batch 4: receipt history, partial receiving, PO/GRN traceability, and
-- over-receipt protection.
-- ============================================================================

ALTER TABLE requisition_items
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_requisition_items_inventory_item
  ON requisition_items(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_receipts (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       uuid REFERENCES organization_settings(id) ON DELETE RESTRICT,
  requisition_id        uuid NOT NULL REFERENCES requisitions(id) ON DELETE RESTRICT,
  requisition_item_id   uuid REFERENCES requisition_items(id) ON DELETE RESTRICT,
  item_id               uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  vendor_id             uuid REFERENCES vendors(id) ON DELETE SET NULL,
  warehouse_id          uuid REFERENCES inventory_warehouses(id) ON DELETE RESTRICT,
  location_id           uuid REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  po_number             text,
  grn_number            text NOT NULL UNIQUE,
  invoice_number        text,
  quantity              numeric NOT NULL CHECK (quantity > 0),
  ordered_quantity      numeric CHECK (ordered_quantity IS NULL OR ordered_quantity > 0),
  unit_cost             numeric NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost            numeric NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  received_at           timestamptz NOT NULL DEFAULT now(),
  received_by           uuid NOT NULL REFERENCES users(id),
  inventory_transaction_id uuid REFERENCES inventory_transactions(id) ON DELETE RESTRICT,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_receipts_requisition
  ON inventory_receipts(requisition_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_item
  ON inventory_receipts(item_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_po
  ON inventory_receipts(po_number)
  WHERE po_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_vendor
  ON inventory_receipts(vendor_id)
  WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_tx
  ON inventory_receipts(inventory_transaction_id)
  WHERE inventory_transaction_id IS NOT NULL;

ALTER TABLE inventory_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_receipts FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Atomic receipt operation
-- ----------------------------------------------------------------------------
-- A PO never calls this function. Only a physical receipt/GRN does. The
-- requisition row and item scope are locked before the received quantity is
-- checked and the canonical inventory receipt transaction is created.
CREATE OR REPLACE FUNCTION receive_inventory_stock(
  p_requisition_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_received_by uuid,
  p_grn_number text,
  p_ordered_quantity numeric DEFAULT NULL,
  p_requisition_item_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_invoice_number text DEFAULT NULL,
  p_received_at timestamptz DEFAULT now(),
  p_reference text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid AS $$
DECLARE
  req_row requisitions%ROWTYPE;
  item_row inventory_items%ROWTYPE;
  line_row requisition_items%ROWTYPE;
  receipt_id uuid;
  transaction_id uuid;
  ordered_quantity numeric;
  received_before numeric;
  unit_cost numeric;
  organization_id uuid;
  grn text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Received quantity must be greater than zero' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO req_row
  FROM requisitions
  WHERE id = p_requisition_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisition % does not exist', p_requisition_id USING ERRCODE = '23503';
  END IF;
  IF req_row.stage NOT IN ('PO', 'Material Received', 'Invoice', 'Payment', 'Completed') THEN
    RAISE EXCEPTION 'Inventory can only be increased from an approved purchase order' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO item_row
  FROM inventory_items
  WHERE id = p_item_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % does not exist', p_item_id USING ERRCODE = '23503';
  END IF;

  IF p_requisition_item_id IS NOT NULL THEN
    SELECT * INTO line_row
    FROM requisition_items
    WHERE id = p_requisition_item_id
      AND requisition_id = p_requisition_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Requisition line item does not belong to the requisition' USING ERRCODE = '23514';
    END IF;
    IF line_row.inventory_item_id IS NOT NULL AND line_row.inventory_item_id <> p_item_id THEN
      RAISE EXCEPTION 'Inventory item does not match the requisition line item' USING ERRCODE = '23514';
    END IF;
  END IF;

  grn := NULLIF(trim(p_grn_number), '');
  IF grn IS NULL THEN
    SELECT next_grn_number() INTO grn;
  END IF;

  -- Idempotent retry for the same GRN returns the existing receipt before any
  -- quantity validation is repeated.
  SELECT id INTO receipt_id FROM inventory_receipts WHERE grn_number = grn;
  IF receipt_id IS NOT NULL THEN
    RETURN receipt_id;
  END IF;

  ordered_quantity := COALESCE(p_ordered_quantity, line_row.quantity);
  IF ordered_quantity IS NULL OR ordered_quantity <= 0 THEN
    RAISE EXCEPTION 'Ordered quantity is required to receive stock and prevent over-receipt' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO received_before
  FROM inventory_receipts
  WHERE requisition_id = p_requisition_id
    AND item_id = p_item_id;
  IF received_before + p_quantity > ordered_quantity THEN
    RAISE EXCEPTION 'Over-receipt rejected: ordered %, already received %, requested %',
      ordered_quantity, received_before, p_quantity USING ERRCODE = '23514';
  END IF;

  organization_id := item_row.organization_id;
  unit_cost := COALESCE(p_unit_cost, item_row.unit_cost, 0);

  INSERT INTO inventory_receipts (
    organization_id, requisition_id, requisition_item_id, item_id, vendor_id,
    warehouse_id, location_id, po_number, grn_number, invoice_number, quantity,
    ordered_quantity, unit_cost, total_cost, received_at, received_by, metadata
  ) VALUES (
    organization_id, p_requisition_id, p_requisition_item_id, p_item_id, req_row.vendor_id,
    p_warehouse_id, p_location_id, req_row.po_number, grn, NULLIF(trim(p_invoice_number), ''),
    p_quantity, ordered_quantity, unit_cost, p_quantity * unit_cost, p_received_at,
    p_received_by, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO receipt_id;

  transaction_id := record_inventory_transaction(
    p_item_id, 'in', p_quantity, p_received_by, item_row.domain, organization_id,
    p_warehouse_id, p_location_id, NULL, NULL, NULL, false,
    COALESCE(p_reference, req_row.pr_number),
    'Goods received for ' || req_row.pr_number || ' (GRN: ' || grn || ')',
    unit_cost, 'inventory_receipt', receipt_id, p_requisition_id, NULL, NULL, NULL, NULL, NULL,
    jsonb_build_object(
      'transaction_kind', 'receipt',
      'receipt_id', receipt_id,
      'requisition_id', p_requisition_id,
      'po_number', req_row.po_number,
      'grn_number', grn
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );

  UPDATE inventory_receipts
  SET inventory_transaction_id = transaction_id
  WHERE id = receipt_id;

  UPDATE requisitions
  SET quantity_received = COALESCE(quantity_received, 0) + p_quantity,
      grn_number = grn,
      delivery_date = COALESCE(p_received_at, now())
  WHERE id = p_requisition_id;

  RETURN receipt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION receive_inventory_stock(
  uuid, uuid, numeric, uuid, text, numeric, uuid, uuid, uuid, numeric, text,
  timestamptz, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receive_inventory_stock(
  uuid, uuid, numeric, uuid, text, numeric, uuid, uuid, uuid, numeric, text,
  timestamptz, text, jsonb
) TO service_role;
