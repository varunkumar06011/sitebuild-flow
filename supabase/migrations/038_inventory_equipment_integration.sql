-- ============================================================================
-- Meditrust ERP — Inventory / Medical Equipment Integration
-- Batch 7: receipt-to-asset linking, optional equipment creation, and
-- inventory/equipment traceability.
-- ============================================================================

ALTER TABLE inventory_receipts
  ADD COLUMN IF NOT EXISTS inventory_asset_id uuid REFERENCES inventory_assets(id) ON DELETE SET NULL;
ALTER TABLE inventory_receipts
  ADD COLUMN IF NOT EXISTS medical_equipment_id uuid REFERENCES medical_equipment(id) ON DELETE SET NULL;

ALTER TABLE inventory_assets
  ADD COLUMN IF NOT EXISTS source_receipt_id uuid REFERENCES inventory_receipts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_receipts_asset
  ON inventory_receipts(inventory_asset_id)
  WHERE inventory_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_equipment
  ON inventory_receipts(medical_equipment_id)
  WHERE medical_equipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_assets_receipt
  ON inventory_assets(source_receipt_id)
  WHERE source_receipt_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Receipt -> inventory asset, with optional medical equipment creation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_asset_from_inventory_receipt(
  p_receipt_id uuid,
  p_asset_number text,
  p_serial_number text DEFAULT NULL,
  p_create_medical_equipment boolean DEFAULT false,
  p_equipment_number text DEFAULT NULL,
  p_manufacturer text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_warranty_start timestamptz DEFAULT NULL,
  p_warranty_end timestamptz DEFAULT NULL,
  p_amc_expiry timestamptz DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid AS $$
DECLARE
  receipt_row inventory_receipts%ROWTYPE;
  item_row inventory_items%ROWTYPE;
  asset_id uuid;
  serial_id uuid;
  equipment_id uuid;
  asset_number text;
  equipment_number text;
  organization_id uuid;
BEGIN
  SELECT * INTO receipt_row
  FROM inventory_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory receipt % does not exist', p_receipt_id USING ERRCODE = '23503';
  END IF;
  IF receipt_row.inventory_asset_id IS NOT NULL THEN
    RETURN receipt_row.inventory_asset_id;
  END IF;

  SELECT * INTO item_row FROM inventory_items WHERE id = receipt_row.item_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item for receipt does not exist' USING ERRCODE = '23503';
  END IF;
  IF item_row.domain <> 'structural' THEN
    RAISE EXCEPTION 'Only structural receipts can create inventory assets' USING ERRCODE = '23514';
  END IF;
  IF NOT item_row.asset_tracking AND NOT item_row.serial_tracking THEN
    RAISE EXCEPTION 'The inventory item is not configured for asset or serial tracking' USING ERRCODE = '23514';
  END IF;
  IF p_asset_number IS NULL OR NULLIF(trim(p_asset_number), '') IS NULL THEN
    RAISE EXCEPTION 'Asset number is required' USING ERRCODE = '22023';
  END IF;
  IF item_row.serial_tracking AND (p_serial_number IS NULL OR NULLIF(trim(p_serial_number), '') IS NULL) THEN
    RAISE EXCEPTION 'Serial number is required for this item' USING ERRCODE = '22023';
  END IF;
  IF receipt_row.quantity <> 1 AND (item_row.asset_tracking OR item_row.serial_tracking) THEN
    RAISE EXCEPTION 'A serialized/asset receipt must have quantity one per asset record' USING ERRCODE = '22023';
  END IF;

  organization_id := item_row.organization_id;
  asset_number := trim(p_asset_number);
  INSERT INTO inventory_assets (
    organization_id, item_id, asset_number, serial_number, manufacturer, model,
    status, warehouse_id, location_id, source_receipt_id, warranty_start,
    warranty_end, amc_expiry, metadata, created_by
  ) VALUES (
    organization_id, receipt_row.item_id, asset_number, NULLIF(trim(p_serial_number), ''),
    NULLIF(trim(p_manufacturer), ''), NULLIF(trim(p_model), ''), 'available',
    receipt_row.warehouse_id, receipt_row.location_id, receipt_row.id,
    p_warranty_start, p_warranty_end, p_amc_expiry, COALESCE(p_metadata, '{}'::jsonb), p_created_by
  ) RETURNING id INTO asset_id;

  IF p_serial_number IS NOT NULL THEN
    INSERT INTO inventory_serials (
      organization_id, item_id, serial_number, batch_id, asset_id, status,
      warehouse_id, location_id, created_by
    ) VALUES (
      organization_id, receipt_row.item_id, trim(p_serial_number), receipt_row.batch_id,
      asset_id, 'available', receipt_row.warehouse_id, receipt_row.location_id, p_created_by
    ) RETURNING id INTO serial_id;
  END IF;

  IF p_create_medical_equipment THEN
    equipment_number := COALESCE(NULLIF(trim(p_equipment_number), ''), asset_number);
    INSERT INTO medical_equipment (
      eq_number, name, model, serial_number, manufacturer, category, location,
      vendor_id, requisition_id, status, warranty_start, warranty_end, amc_expiry,
      notes
    ) VALUES (
      equipment_number, item_row.name, NULLIF(trim(p_model), ''), NULLIF(trim(p_serial_number), ''),
      NULLIF(trim(p_manufacturer), ''), 'Inventory Asset', NULLIF(trim(p_location), ''),
      receipt_row.vendor_id, receipt_row.requisition_id, 'Delivered', p_warranty_start,
      p_warranty_end, p_amc_expiry, 'Created from inventory receipt ' || receipt_row.grn_number
    ) RETURNING id INTO equipment_id;

    UPDATE inventory_assets
    SET medical_equipment_id = equipment_id
    WHERE id = asset_id;
  END IF;

  UPDATE inventory_receipts
  SET inventory_asset_id = asset_id,
      medical_equipment_id = equipment_id
  WHERE id = receipt_row.id;

  IF serial_id IS NOT NULL THEN
    UPDATE inventory_transactions
    SET linked_serial_id = serial_id,
        linked_asset_id = asset_id
    WHERE id = receipt_row.inventory_transaction_id;
  ELSE
    UPDATE inventory_transactions
    SET linked_asset_id = asset_id
    WHERE id = receipt_row.inventory_transaction_id;
  END IF;

  RETURN asset_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION create_asset_from_inventory_receipt(
  uuid, text, text, boolean, text, text, text, timestamptz, timestamptz,
  timestamptz, text, uuid, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_asset_from_inventory_receipt(
  uuid, text, text, boolean, text, text, text, timestamptz, timestamptz,
  timestamptz, text, uuid, jsonb
) TO service_role;
