-- ============================================================================
-- Meditrust ERP — Civil Inventory Consumption
-- Batch 3: atomic used/wasted consumption, construction traceability, and
-- consumption reversals.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Configurable wastage reasons
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_wastage_reasons (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid REFERENCES organization_settings(id) ON DELETE RESTRICT,
  domain          text NOT NULL DEFAULT 'civil'
                  CHECK (domain IN ('civil', 'structural')),
  name            text NOT NULL,
  description     text,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, domain, name)
);

CREATE INDEX IF NOT EXISTS idx_inventory_wastage_reasons_scope
  ON inventory_wastage_reasons(organization_id, domain, is_active);

-- Consumption is the business event. Its linked OUT rows remain the canonical
-- stock ledger entries and are created atomically with this record.
CREATE TABLE IF NOT EXISTS inventory_consumptions (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       uuid REFERENCES organization_settings(id) ON DELETE RESTRICT,
  domain                text NOT NULL DEFAULT 'civil'
                        CHECK (domain = 'civil'),
  item_id               uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  warehouse_id          uuid REFERENCES inventory_warehouses(id) ON DELETE RESTRICT,
  location_id           uuid REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  block_id              uuid REFERENCES progress_blocks(id) ON DELETE RESTRICT,
  floor_id              uuid REFERENCES progress_floors(id) ON DELETE RESTRICT,
  cell_id               uuid REFERENCES progress_cells(id) ON DELETE RESTRICT,
  work_item_id          uuid REFERENCES progress_work_items(id) ON DELETE RESTRICT,
  used_quantity         numeric NOT NULL DEFAULT 0 CHECK (used_quantity >= 0),
  wasted_quantity       numeric NOT NULL DEFAULT 0 CHECK (wasted_quantity >= 0),
  wastage_reason_id     uuid REFERENCES inventory_wastage_reasons(id) ON DELETE RESTRICT,
  wastage_reason        text,
  unit_cost             numeric NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  used_cost             numeric NOT NULL DEFAULT 0 CHECK (used_cost >= 0),
  wasted_cost           numeric NOT NULL DEFAULT 0 CHECK (wasted_cost >= 0),
  total_cost            numeric NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  used_transaction_id   uuid REFERENCES inventory_transactions(id) ON DELETE RESTRICT,
  waste_transaction_id  uuid REFERENCES inventory_transactions(id) ON DELETE RESTRICT,
  reversed_used_quantity numeric NOT NULL DEFAULT 0 CHECK (reversed_used_quantity >= 0),
  reversed_wasted_quantity numeric NOT NULL DEFAULT 0 CHECK (reversed_wasted_quantity >= 0),
  reference             text,
  remarks               text,
  consumed_at          timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (used_quantity + wasted_quantity > 0),
  CHECK (reversed_used_quantity <= used_quantity),
  CHECK (reversed_wasted_quantity <= wasted_quantity),
  CHECK (wasted_quantity = 0 OR wastage_reason_id IS NOT NULL OR NULLIF(trim(wastage_reason), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_inventory_consumptions_item_date
  ON inventory_consumptions(item_id, consumed_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_consumptions_civil_context
  ON inventory_consumptions(block_id, floor_id, cell_id, work_item_id, consumed_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_consumptions_scope
  ON inventory_consumptions(organization_id, domain, warehouse_id, location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_consumptions_used_tx
  ON inventory_consumptions(used_transaction_id)
  WHERE used_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_consumptions_waste_tx
  ON inventory_consumptions(waste_transaction_id)
  WHERE waste_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_consumption_reversals (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  consumption_id        uuid NOT NULL REFERENCES inventory_consumptions(id) ON DELETE RESTRICT,
  used_quantity         numeric NOT NULL DEFAULT 0 CHECK (used_quantity >= 0),
  wasted_quantity       numeric NOT NULL DEFAULT 0 CHECK (wasted_quantity >= 0),
  used_reversal_tx_id   uuid REFERENCES inventory_transactions(id) ON DELETE RESTRICT,
  waste_reversal_tx_id  uuid REFERENCES inventory_transactions(id) ON DELETE RESTRICT,
  reason                text,
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (used_quantity + wasted_quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_consumption_reversals_consumption
  ON inventory_consumption_reversals(consumption_id, created_at);

ALTER TABLE inventory_wastage_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_consumption_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_wastage_reasons, inventory_consumptions, inventory_consumption_reversals
FROM anon, authenticated;

-- Consumption is a valid transaction semantic in addition to the Batch 2
-- movement kinds.
ALTER TABLE inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_kind_check;
ALTER TABLE inventory_transactions
  ADD CONSTRAINT inventory_transactions_kind_check
  CHECK (transaction_kind IN ('movement', 'receipt', 'issue', 'adjustment', 'return', 'transfer', 'consumption', 'reversal'));

-- ----------------------------------------------------------------------------
-- Atomic Civil consumption
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_inventory_consumption(
  p_item_id uuid,
  p_used_quantity numeric,
  p_wasted_quantity numeric,
  p_created_by uuid,
  p_domain text DEFAULT 'civil',
  p_organization_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_block_id uuid DEFAULT NULL,
  p_floor_id uuid DEFAULT NULL,
  p_cell_id uuid DEFAULT NULL,
  p_work_item_id uuid DEFAULT NULL,
  p_wastage_reason_id uuid DEFAULT NULL,
  p_wastage_reason text DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_remarks text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid AS $$
DECLARE
  item_domain text;
  organization_id uuid;
  unit_cost numeric;
  consumption_id uuid;
  used_tx_id uuid;
  waste_tx_id uuid;
  required_quantity numeric;
  common_metadata jsonb;
BEGIN
  IF p_domain <> 'civil' THEN
    RAISE EXCEPTION 'Inventory consumption is currently supported only for the civil domain' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_used_quantity, 0) < 0 OR COALESCE(p_wasted_quantity, 0) < 0 THEN
    RAISE EXCEPTION 'Used and wasted quantities cannot be negative' USING ERRCODE = '22023';
  END IF;

  required_quantity := COALESCE(p_used_quantity, 0) + COALESCE(p_wasted_quantity, 0);
  IF required_quantity <= 0 THEN
    RAISE EXCEPTION 'Used plus wasted quantity must be greater than zero' USING ERRCODE = '22023';
  END IF;
  IF required_quantity > 0 AND COALESCE(p_wasted_quantity, 0) > 0
     AND p_wastage_reason_id IS NULL AND NULLIF(trim(p_wastage_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A wastage reason is required when wasted quantity is recorded' USING ERRCODE = '22023';
  END IF;

  SELECT domain, organization_id INTO item_domain, organization_id
  FROM inventory_items
  WHERE id = p_item_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % does not exist', p_item_id USING ERRCODE = '23503';
  END IF;
  IF item_domain = 'structural' THEN
    RAISE EXCEPTION 'Structural items cannot be recorded as civil consumption' USING ERRCODE = '23514';
  END IF;
  IF p_organization_id IS NOT NULL THEN
    organization_id := p_organization_id;
  END IF;

  IF p_wastage_reason_id IS NOT NULL THEN
    PERFORM 1
    FROM inventory_wastage_reasons
    WHERE id = p_wastage_reason_id
      AND domain = 'civil'
      AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid or inactive civil wastage reason' USING ERRCODE = '23503';
    END IF;
  END IF;

  IF p_floor_id IS NOT NULL AND p_block_id IS NOT NULL THEN
    PERFORM 1 FROM progress_floors WHERE id = p_floor_id AND block_id = p_block_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Floor does not belong to the selected block' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF p_cell_id IS NOT NULL THEN
    PERFORM 1
    FROM progress_cells c
    JOIN progress_cell_groups g ON g.id = c.cell_group_id
    WHERE c.id = p_cell_id
      AND (p_block_id IS NULL OR g.block_id = p_block_id)
      AND (p_floor_id IS NULL OR g.floor_id = p_floor_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cell does not belong to the selected construction context' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF p_work_item_id IS NOT NULL THEN
    PERFORM 1 FROM progress_work_items WHERE id = p_work_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Work item does not exist' USING ERRCODE = '23503';
    END IF;
  END IF;

  -- Use an explicit cost when supplied, otherwise calculate the current
  -- weighted receipt/return cost for this stock scope, then item fallback.
  SELECT COALESCE(
    p_unit_cost,
    (
      SELECT SUM(t.quantity * t.unit_cost) / NULLIF(SUM(t.quantity), 0)
      FROM inventory_transactions t
      WHERE t.item_id = p_item_id
        AND t.type = 'in'
        AND NOT t.reversed
        AND t.warehouse_id IS NOT DISTINCT FROM p_warehouse_id
        AND t.location_id IS NOT DISTINCT FROM p_location_id
    ),
    i.unit_cost,
    0
  ) INTO unit_cost
  FROM inventory_items i
  WHERE i.id = p_item_id;

  common_metadata := jsonb_build_object(
    'transaction_kind', 'consumption',
    'consumption_domain', 'civil',
    'block_id', p_block_id,
    'floor_id', p_floor_id,
    'cell_id', p_cell_id,
    'work_item_id', p_work_item_id,
    'wastage_reason_id', p_wastage_reason_id,
    'wastage_reason', NULLIF(trim(p_wastage_reason), '')
  ) || COALESCE(p_metadata, '{}'::jsonb);

  INSERT INTO inventory_consumptions (
    organization_id, domain, item_id, warehouse_id, location_id, block_id, floor_id,
    cell_id, work_item_id, used_quantity, wasted_quantity, wastage_reason_id,
    wastage_reason, unit_cost, used_cost, wasted_cost, total_cost, reference,
    remarks, created_by
  ) VALUES (
    organization_id, 'civil', p_item_id, p_warehouse_id, p_location_id, p_block_id, p_floor_id,
    p_cell_id, p_work_item_id, COALESCE(p_used_quantity, 0), COALESCE(p_wasted_quantity, 0),
    p_wastage_reason_id, NULLIF(trim(p_wastage_reason), ''), unit_cost,
    COALESCE(p_used_quantity, 0) * unit_cost, COALESCE(p_wasted_quantity, 0) * unit_cost,
    required_quantity * unit_cost, p_reference, p_remarks, p_created_by
  ) RETURNING id INTO consumption_id;

  IF COALESCE(p_used_quantity, 0) > 0 THEN
    used_tx_id := record_inventory_transaction(
      p_item_id, 'out', p_used_quantity, p_created_by, 'civil', organization_id,
      p_warehouse_id, p_location_id, NULL, NULL, NULL, false,
      p_reference, p_remarks, unit_cost, COALESCE(p_reference_type, 'inventory_consumption'),
      COALESCE(p_reference_id, consumption_id), NULL, NULL, NULL, p_block_id, NULL, NULL,
      common_metadata || jsonb_build_object('consumption_id', consumption_id, 'quantity_role', 'used')
    );
  END IF;

  IF COALESCE(p_wasted_quantity, 0) > 0 THEN
    waste_tx_id := record_inventory_transaction(
      p_item_id, 'out', p_wasted_quantity, p_created_by, 'civil', organization_id,
      p_warehouse_id, p_location_id, NULL, NULL, NULL, true,
      p_reference, p_remarks, unit_cost, COALESCE(p_reference_type, 'inventory_consumption'),
      COALESCE(p_reference_id, consumption_id), NULL, NULL, NULL, p_block_id, NULL, NULL,
      common_metadata || jsonb_build_object('consumption_id', consumption_id, 'quantity_role', 'wasted', 'reason_code', 'wastage')
    );
  END IF;

  UPDATE inventory_consumptions
  SET used_transaction_id = used_tx_id,
      waste_transaction_id = waste_tx_id
  WHERE id = consumption_id;

  RETURN consumption_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION record_inventory_consumption(
  uuid, numeric, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  uuid, text, numeric, text, text, text, uuid, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_inventory_consumption(
  uuid, numeric, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  uuid, text, numeric, text, text, text, uuid, jsonb
) TO service_role;

-- ----------------------------------------------------------------------------
-- Atomic Civil consumption reversal
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_inventory_consumption(
  p_consumption_id uuid,
  p_created_by uuid,
  p_used_quantity numeric DEFAULT NULL,
  p_wasted_quantity numeric DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  consumption inventory_consumptions%ROWTYPE;
  used_reversed numeric;
  wasted_reversed numeric;
  reverse_used numeric;
  reverse_wasted numeric;
  used_reversal_id uuid;
  waste_reversal_id uuid;
  reversal_id uuid;
BEGIN
  SELECT * INTO consumption
  FROM inventory_consumptions
  WHERE id = p_consumption_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consumption % does not exist', p_consumption_id USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(SUM(used_quantity), 0), COALESCE(SUM(wasted_quantity), 0)
  INTO used_reversed, wasted_reversed
  FROM inventory_consumption_reversals
  WHERE consumption_id = consumption.id;

  reverse_used := COALESCE(p_used_quantity, consumption.used_quantity - used_reversed);
  reverse_wasted := COALESCE(p_wasted_quantity, consumption.wasted_quantity - wasted_reversed);
  IF reverse_used < 0 OR reverse_wasted < 0
     OR reverse_used > consumption.used_quantity - used_reversed
     OR reverse_wasted > consumption.wasted_quantity - wasted_reversed
     OR reverse_used + reverse_wasted <= 0 THEN
    RAISE EXCEPTION 'Consumption reversal exceeds the remaining reversible quantities' USING ERRCODE = '23514';
  END IF;

  IF reverse_used > 0 THEN
    IF consumption.used_transaction_id IS NULL THEN
      RAISE EXCEPTION 'Consumption has no used ledger transaction' USING ERRCODE = '23514';
    END IF;
    used_reversal_id := reverse_inventory_transaction(
      consumption.used_transaction_id,
      p_created_by,
      p_reason,
      reverse_used
    );
  END IF;

  IF reverse_wasted > 0 THEN
    IF consumption.waste_transaction_id IS NULL THEN
      RAISE EXCEPTION 'Consumption has no wastage ledger transaction' USING ERRCODE = '23514';
    END IF;
    waste_reversal_id := reverse_inventory_transaction(
      consumption.waste_transaction_id,
      p_created_by,
      p_reason,
      reverse_wasted
    );
  END IF;

  INSERT INTO inventory_consumption_reversals (
    consumption_id, used_quantity, wasted_quantity, used_reversal_tx_id,
    waste_reversal_tx_id, reason, created_by
  ) VALUES (
    consumption.id, reverse_used, reverse_wasted, used_reversal_id,
    waste_reversal_id, p_reason, p_created_by
  ) RETURNING id INTO reversal_id;

  UPDATE inventory_consumptions
  SET reversed_used_quantity = used_reversed + reverse_used,
      reversed_wasted_quantity = wasted_reversed + reverse_wasted
  WHERE id = consumption.id;

  RETURN reversal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION reverse_inventory_consumption(uuid, uuid, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reverse_inventory_consumption(uuid, uuid, numeric, numeric, text) TO service_role;
