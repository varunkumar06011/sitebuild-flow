-- ============================================================================
-- Meditrust ERP — Structural Inventory Tracking
-- Batch 5: tracking modes, batches/expiry, serials, generic assets, structural
-- locations, issues, and returns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Receipt batch linkage
-- ----------------------------------------------------------------------------
ALTER TABLE inventory_receipts
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_batch
  ON inventory_receipts(batch_id)
  WHERE batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION receive_inventory_stock_with_batch(
  p_requisition_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_received_by uuid,
  p_grn_number text,
  p_ordered_quantity numeric,
  p_batch_id uuid,
  p_warehouse_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_invoice_number text DEFAULT NULL,
  p_received_at timestamptz DEFAULT now()
)
RETURNS uuid AS $$
DECLARE
  receipt_id uuid;
  transaction_id uuid;
BEGIN
  PERFORM 1 FROM batches WHERE id = p_batch_id AND (inventory_item_id IS NULL OR inventory_item_id = p_item_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch does not belong to the selected item' USING ERRCODE = '23514';
  END IF;
  receipt_id := receive_inventory_stock(
    p_requisition_id, p_item_id, p_quantity, p_received_by, p_grn_number,
    p_ordered_quantity, NULL, p_warehouse_id, p_location_id, p_unit_cost,
    p_invoice_number, p_received_at, NULL, jsonb_build_object('batch_id', p_batch_id)
  );
  SELECT inventory_transaction_id INTO transaction_id FROM inventory_receipts WHERE id = receipt_id FOR UPDATE;
  UPDATE inventory_receipts SET batch_id = p_batch_id WHERE id = receipt_id;
  UPDATE inventory_transactions SET linked_batch_id = p_batch_id WHERE id = transaction_id;
  UPDATE batches SET quantity_received = quantity_received + p_quantity WHERE id = p_batch_id;
  RETURN receipt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION receive_inventory_stock_with_batch(
  uuid, uuid, numeric, uuid, text, numeric, uuid, uuid, uuid, numeric, text, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receive_inventory_stock_with_batch(
  uuid, uuid, numeric, uuid, text, numeric, uuid, uuid, uuid, numeric, text, timestamptz
) TO service_role;

-- ----------------------------------------------------------------------------
-- Item tracking configuration
-- ----------------------------------------------------------------------------
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS tracking_mode text NOT NULL DEFAULT 'normal';
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS batch_tracking boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS expiry_tracking boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS serial_tracking boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS asset_tracking boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS expiry_enforced boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS fefo_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_tracking_mode_check;
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_tracking_mode_check
  CHECK (tracking_mode IN ('normal', 'consumable', 'asset', 'batch', 'expiry', 'serialized'));

-- ----------------------------------------------------------------------------
-- Batch extensions
-- ----------------------------------------------------------------------------
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization_settings(id) ON DELETE RESTRICT;
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL;
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS manufacture_date timestamptz;
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS expiry_date timestamptz;
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS quantity_received numeric NOT NULL DEFAULT 0 CHECK (quantity_received >= 0);

CREATE INDEX IF NOT EXISTS idx_batches_inventory_item
  ON batches(inventory_item_id, expiry_date)
  WHERE inventory_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_batches_expiry
  ON batches(expiry_date)
  WHERE expiry_date IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Generic serialized inventory and assets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_assets (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       uuid REFERENCES organization_settings(id) ON DELETE RESTRICT,
  item_id               uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  asset_number          text NOT NULL,
  serial_number         text,
  manufacturer          text,
  model                 text,
  status                text NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'assigned', 'installed', 'maintenance', 'retired', 'lost')),
  warehouse_id          uuid REFERENCES inventory_warehouses(id) ON DELETE SET NULL,
  location_id           uuid REFERENCES inventory_locations(id) ON DELETE SET NULL,
  medical_equipment_id  uuid REFERENCES medical_equipment(id) ON DELETE SET NULL,
  warranty_start        timestamptz,
  warranty_end          timestamptz,
  amc_expiry            timestamptz,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, asset_number),
  UNIQUE (organization_id, serial_number)
);

CREATE TABLE IF NOT EXISTS inventory_serials (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       uuid REFERENCES organization_settings(id) ON DELETE RESTRICT,
  item_id               uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  serial_number         text NOT NULL,
  batch_id              uuid REFERENCES batches(id) ON DELETE SET NULL,
  asset_id              uuid REFERENCES inventory_assets(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'issued', 'installed', 'maintenance', 'retired', 'lost')),
  warehouse_id          uuid REFERENCES inventory_warehouses(id) ON DELETE SET NULL,
  location_id           uuid REFERENCES inventory_locations(id) ON DELETE SET NULL,
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, serial_number)
);

ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS linked_serial_id uuid REFERENCES inventory_serials(id) ON DELETE SET NULL;
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS linked_asset_id uuid REFERENCES inventory_assets(id) ON DELETE SET NULL;

ALTER TABLE medical_equipment
  ADD COLUMN IF NOT EXISTS inventory_asset_id uuid REFERENCES inventory_assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_assets_item_location
  ON inventory_assets(item_id, warehouse_id, location_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_serials_item_location
  ON inventory_serials(item_id, warehouse_id, location_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_serial
  ON inventory_transactions(linked_serial_id)
  WHERE linked_serial_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_tx_asset
  ON inventory_transactions(linked_asset_id)
  WHERE linked_asset_id IS NOT NULL;

ALTER TABLE inventory_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_serials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_assets, inventory_serials FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Structural location APIs use the existing inventory_locations hierarchy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_structural_location(
  p_location_id uuid,
  p_organization_id uuid DEFAULT NULL
)
RETURNS boolean AS $$
BEGIN
  IF p_location_id IS NULL THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM inventory_locations
    WHERE id = p_location_id
      AND domain = 'structural'
      AND is_active
      AND (p_organization_id IS NULL OR organization_id IS NOT DISTINCT FROM p_organization_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ----------------------------------------------------------------------------
-- Atomic structural issue
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION issue_structural_inventory(
  p_item_id uuid,
  p_quantity numeric,
  p_created_by uuid,
  p_warehouse_id uuid DEFAULT NULL,
  p_source_location_id uuid DEFAULT NULL,
  p_destination_location_id uuid DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_serial_id uuid DEFAULT NULL,
  p_asset_id uuid DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_remarks text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid AS $$
DECLARE
  item_row inventory_items%ROWTYPE;
  serial_row inventory_serials%ROWTYPE;
  batch_expiry timestamptz;
  organization_id uuid;
  tx_id uuid;
BEGIN
  SELECT * INTO item_row FROM inventory_items WHERE id = p_item_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % does not exist', p_item_id USING ERRCODE = '23503';
  END IF;
  IF item_row.domain <> 'structural' THEN
    RAISE EXCEPTION 'Structural issue requires a structural inventory item' USING ERRCODE = '23514';
  END IF;
  IF NOT validate_structural_location(p_destination_location_id, item_row.organization_id) THEN
    RAISE EXCEPTION 'Destination is not an active structural inventory location' USING ERRCODE = '23514';
  END IF;

  organization_id := item_row.organization_id;
  IF item_row.batch_tracking OR item_row.expiry_tracking OR item_row.tracking_mode IN ('batch', 'expiry') THEN
    IF p_batch_id IS NULL THEN
      RAISE EXCEPTION 'A batch is required for this item' USING ERRCODE = '22023';
    END IF;
    SELECT expiry_date INTO batch_expiry FROM batches
    WHERE id = p_batch_id
      AND (inventory_item_id IS NULL OR inventory_item_id = p_item_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Batch does not belong to the selected item' USING ERRCODE = '23514';
    END IF;
    IF item_row.expiry_enforced AND batch_expiry IS NOT NULL AND batch_expiry <= now() THEN
      RAISE EXCEPTION 'Expired stock cannot be issued' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_batch_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_item_id::text || ':batch:' || p_batch_id::text, 0)
    );
    IF (
      SELECT COALESCE(SUM(
        CASE
          WHEN type = 'in' AND NOT reversed THEN quantity
          WHEN type = 'out' AND NOT reversed THEN -quantity
          WHEN type = 'adjustment' AND NOT reversed AND adjustment_direction = 'up' THEN quantity
          WHEN type = 'adjustment' AND NOT reversed AND adjustment_direction = 'down' THEN -quantity
          ELSE 0
        END
      ), 0)
      FROM inventory_transactions
      WHERE item_id = p_item_id AND linked_batch_id = p_batch_id
        AND warehouse_id IS NOT DISTINCT FROM p_warehouse_id
    ) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock in the selected batch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF item_row.serial_tracking OR item_row.tracking_mode = 'serialized' THEN
    IF p_serial_id IS NULL OR p_quantity <> 1 THEN
      RAISE EXCEPTION 'A serialized issue requires one serial number and quantity one' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO serial_row FROM inventory_serials
    WHERE id = p_serial_id AND item_id = p_item_id
    FOR UPDATE;
    IF NOT FOUND OR serial_row.status <> 'available' THEN
      RAISE EXCEPTION 'Serial is unavailable for issue' USING ERRCODE = '23514';
    END IF;
    IF p_batch_id IS NOT NULL AND serial_row.batch_id IS NOT NULL AND serial_row.batch_id <> p_batch_id THEN
      RAISE EXCEPTION 'Serial does not belong to the selected batch' USING ERRCODE = '23514';
    END IF;
  END IF;

  tx_id := record_inventory_transaction(
    p_item_id, 'out', p_quantity, p_created_by, 'structural', organization_id,
    p_warehouse_id, p_source_location_id, NULL, p_destination_location_id, NULL, false,
    p_reference, p_remarks, p_unit_cost, 'structural_issue', NULL, NULL, NULL, p_batch_id,
    NULL, NULL, NULL,
    jsonb_build_object(
      'transaction_kind', 'issue',
      'structural_issue', true,
      'destination_location_id', p_destination_location_id,
      'batch_id', p_batch_id,
      'serial_id', p_serial_id,
      'asset_id', p_asset_id
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );

  UPDATE inventory_transactions
  SET linked_serial_id = p_serial_id,
      linked_asset_id = p_asset_id
  WHERE id = tx_id;

  IF p_serial_id IS NOT NULL THEN
    UPDATE inventory_serials
    SET status = CASE WHEN p_destination_location_id IS NULL THEN 'issued' ELSE 'installed' END,
        warehouse_id = NULL,
        location_id = p_destination_location_id
    WHERE id = p_serial_id;
  END IF;
  IF p_asset_id IS NOT NULL THEN
    UPDATE inventory_assets
    SET status = CASE WHEN p_destination_location_id IS NULL THEN 'assigned' ELSE 'installed' END,
        warehouse_id = NULL,
        location_id = p_destination_location_id
    WHERE id = p_asset_id AND item_id = p_item_id;
  END IF;

  RETURN tx_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION issue_structural_inventory(
  uuid, numeric, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_structural_inventory(
  uuid, numeric, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text, jsonb
) TO service_role;

-- ----------------------------------------------------------------------------
-- Structural return
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_structural_returns (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_transaction_id  uuid NOT NULL REFERENCES inventory_transactions(id) ON DELETE RESTRICT,
  return_transaction_id uuid NOT NULL REFERENCES inventory_transactions(id) ON DELETE RESTRICT,
  item_id               uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity              numeric NOT NULL CHECK (quantity > 0),
  returned_to_warehouse_id uuid REFERENCES inventory_warehouses(id) ON DELETE SET NULL,
  returned_to_location_id uuid REFERENCES inventory_locations(id) ON DELETE SET NULL,
  reason                text,
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_structural_returns_issue
  ON inventory_structural_returns(issue_transaction_id);

ALTER TABLE inventory_structural_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_structural_returns FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Atomic structural return
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION return_structural_inventory(
  p_issue_transaction_id uuid,
  p_quantity numeric,
  p_created_by uuid,
  p_warehouse_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  issue_tx inventory_transactions%ROWTYPE;
  returned_before numeric;
  return_tx_id uuid;
  return_id uuid;
BEGIN
  SELECT * INTO issue_tx
  FROM inventory_transactions
  WHERE id = p_issue_transaction_id
  FOR UPDATE;
  IF NOT FOUND OR issue_tx.type <> 'out' OR issue_tx.domain <> 'structural' THEN
    RAISE EXCEPTION 'A structural issue transaction is required for return' USING ERRCODE = '23514';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Return quantity must be greater than zero' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO returned_before
  FROM inventory_structural_returns
  WHERE issue_transaction_id = issue_tx.id;
  IF returned_before + p_quantity > issue_tx.quantity THEN
    RAISE EXCEPTION 'Return exceeds the remaining issued quantity' USING ERRCODE = '23514';
  END IF;
  IF issue_tx.linked_serial_id IS NOT NULL AND p_quantity <> 1 THEN
    RAISE EXCEPTION 'A serialized item must be returned one serial at a time' USING ERRCODE = '22023';
  END IF;

  return_tx_id := record_inventory_transaction(
    issue_tx.item_id, 'in', p_quantity, p_created_by, 'structural', issue_tx.organization_id,
    p_warehouse_id, p_location_id, NULL, NULL, NULL, false,
    'RETURN of tx ' || left(issue_tx.id::text, 8),
    COALESCE(p_reason, 'Return of structural inventory'), issue_tx.unit_cost,
    'structural_return', issue_tx.id, NULL, NULL, issue_tx.linked_batch_id, NULL, NULL, NULL,
    jsonb_build_object(
      'transaction_kind', 'return',
      'issue_transaction_id', issue_tx.id,
      'serial_id', issue_tx.linked_serial_id,
      'asset_id', issue_tx.linked_asset_id
    )
  );

  INSERT INTO inventory_structural_returns (
    issue_transaction_id, return_transaction_id, item_id, quantity,
    returned_to_warehouse_id, returned_to_location_id, reason, created_by
  ) VALUES (
    issue_tx.id, return_tx_id, issue_tx.item_id, p_quantity,
    p_warehouse_id, p_location_id, p_reason, p_created_by
  ) RETURNING id INTO return_id;

  IF issue_tx.linked_serial_id IS NOT NULL THEN
    UPDATE inventory_serials
    SET status = 'available', warehouse_id = p_warehouse_id, location_id = p_location_id
    WHERE id = issue_tx.linked_serial_id;
  END IF;
  IF issue_tx.linked_asset_id IS NOT NULL THEN
    UPDATE inventory_assets
    SET status = 'available', warehouse_id = p_warehouse_id, location_id = p_location_id
    WHERE id = issue_tx.linked_asset_id;
  END IF;

  RETURN return_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION return_structural_inventory(uuid, numeric, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION return_structural_inventory(uuid, numeric, uuid, uuid, uuid, text) TO service_role;
