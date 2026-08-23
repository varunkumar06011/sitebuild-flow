  -- ============================================================================
-- Meditrust ERP — Inventory Foundation
-- Batch 1: shared Civil/Structural domains, scoped locations, transaction
-- metadata, indexes, and atomic stock mutations.
--
-- This migration is additive. Existing inventory tables remain canonical and
-- legacy rows are retained. Existing nullable organization links are backfilled
-- from the current organization_settings row when one exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared domain and organization scope
-- ----------------------------------------------------------------------------
ALTER TABLE inventory_categories
  ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT 'uncategorized';
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization_settings(id) ON DELETE RESTRICT;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT 'uncategorized';
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization_settings(id) ON DELETE RESTRICT;
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT 'uncategorized';
ALTER TABLE inventory_warehouses
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization_settings(id) ON DELETE RESTRICT;
ALTER TABLE inventory_warehouses
  ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT 'uncategorized';
ALTER TABLE inventory_alerts
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization_settings(id) ON DELETE RESTRICT;
ALTER TABLE inventory_budgets
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization_settings(id) ON DELETE RESTRICT;

ALTER TABLE inventory_categories
  DROP CONSTRAINT IF EXISTS inventory_categories_domain_check;
ALTER TABLE inventory_categories
  ADD CONSTRAINT inventory_categories_domain_check
  CHECK (domain IN ('civil', 'structural', 'uncategorized'));
ALTER TABLE inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_domain_check;
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_domain_check
  CHECK (domain IN ('civil', 'structural', 'uncategorized'));
ALTER TABLE inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_domain_check;
ALTER TABLE inventory_transactions
  ADD CONSTRAINT inventory_transactions_domain_check
  CHECK (domain IN ('civil', 'structural', 'uncategorized'));
ALTER TABLE inventory_warehouses
  DROP CONSTRAINT IF EXISTS inventory_warehouses_domain_check;
ALTER TABLE inventory_warehouses
  ADD CONSTRAINT inventory_warehouses_domain_check
  CHECK (domain IN ('civil', 'structural', 'uncategorized'));

-- Existing classification is the safest source for legacy item domains.
UPDATE inventory_items
SET domain = work_category
WHERE work_category IN ('civil', 'structural');
UPDATE inventory_transactions t
SET domain = i.domain
FROM inventory_items i
WHERE i.id = t.item_id AND i.domain IN ('civil', 'structural');

-- Current deployments use one organization_settings row. This backfill is
-- intentionally nullable so an empty development database remains migratable.
UPDATE inventory_items
SET organization_id = (SELECT id FROM organization_settings ORDER BY id LIMIT 1)
WHERE organization_id IS NULL;
UPDATE inventory_transactions
SET organization_id = (SELECT id FROM organization_settings ORDER BY id LIMIT 1)
WHERE organization_id IS NULL;
UPDATE inventory_warehouses
SET organization_id = (SELECT id FROM organization_settings ORDER BY id LIMIT 1)
WHERE organization_id IS NULL;
UPDATE inventory_alerts
SET organization_id = (SELECT id FROM organization_settings ORDER BY id LIMIT 1)
WHERE organization_id IS NULL;
UPDATE inventory_budgets
SET organization_id = (SELECT id FROM organization_settings ORDER BY id LIMIT 1)
WHERE organization_id IS NULL;

-- ----------------------------------------------------------------------------
-- Generalized inventory locations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_locations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid REFERENCES organization_settings(id) ON DELETE RESTRICT,
  domain          text NOT NULL DEFAULT 'uncategorized'
                  CHECK (domain IN ('civil', 'structural', 'uncategorized')),
  parent_id       uuid REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  code            text,
  location_type   text NOT NULL DEFAULT 'location',
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE inventory_warehouses
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES inventory_locations(id) ON DELETE SET NULL;
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES inventory_locations(id) ON DELETE SET NULL;
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS destination_warehouse_id uuid REFERENCES inventory_warehouses(id) ON DELETE SET NULL;
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS destination_location_id uuid REFERENCES inventory_locations(id) ON DELETE SET NULL;
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS transfer_group_id uuid;

-- ----------------------------------------------------------------------------
-- Transaction metadata and immutable event context
-- ----------------------------------------------------------------------------
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS reference_type text;
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS reference_id uuid;
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Keep item work_category and the canonical transaction domain aligned for new
-- writes. Legacy uncategorized records remain explicitly unresolved.
CREATE OR REPLACE FUNCTION validate_inventory_transaction_context()
RETURNS trigger AS $$
DECLARE
  item_domain text;
BEGIN
  SELECT domain INTO item_domain FROM inventory_items WHERE id = NEW.item_id;
  IF item_domain IS NULL THEN
    RAISE EXCEPTION 'Inventory item % does not exist', NEW.item_id USING ERRCODE = '23503';
  END IF;
  IF NEW.domain = 'uncategorized' AND item_domain IN ('civil', 'structural') THEN
    NEW.domain := item_domain;
  END IF;
  IF NEW.type = 'adjustment' AND NEW.adjustment_direction IS NULL THEN
    RAISE EXCEPTION 'Adjustment direction is required' USING ERRCODE = '22023';
  END IF;
  IF NEW.type <> 'adjustment' AND NEW.adjustment_direction IS NOT NULL THEN
    RAISE EXCEPTION 'Adjustment direction is only valid for adjustments' USING ERRCODE = '22023';
  END IF;
  IF NEW.is_wastage AND NEW.type <> 'out' THEN
    RAISE EXCEPTION 'Wastage is only valid for out transactions' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_inventory_transaction_context ON inventory_transactions;
CREATE TRIGGER trg_validate_inventory_transaction_context
BEFORE INSERT ON inventory_transactions
FOR EACH ROW EXECUTE FUNCTION validate_inventory_transaction_context();

-- ----------------------------------------------------------------------------
-- Indexes for scoped reads and traceability
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inventory_items_org_domain
  ON inventory_items(organization_id, domain, archived);
CREATE INDEX IF NOT EXISTS idx_inventory_categories_domain
  ON inventory_categories(domain, archived);
CREATE INDEX IF NOT EXISTS idx_inventory_warehouses_org_domain
  ON inventory_warehouses(organization_id, domain, is_active);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_org_domain
  ON inventory_locations(organization_id, domain, parent_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_org_domain_date
  ON inventory_transactions(organization_id, domain, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_item_scope
  ON inventory_transactions(item_id, warehouse_id, location_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_reference
  ON inventory_transactions(reference_type, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_tx_transfer_group
  ON inventory_transactions(transfer_group_id)
  WHERE transfer_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_tx_destination
  ON inventory_transactions(destination_warehouse_id, destination_location_id)
  WHERE destination_warehouse_id IS NOT NULL OR destination_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_org_domain
  ON inventory_alerts(organization_id, is_resolved);
CREATE INDEX IF NOT EXISTS idx_inventory_budgets_org
  ON inventory_budgets(organization_id, item_id);

-- ----------------------------------------------------------------------------
-- Atomic inventory transaction function
-- ----------------------------------------------------------------------------
-- Locks one item/warehouse/location scope for the duration of the transaction,
-- validates available stock, and inserts the immutable ledger row atomically.
-- For transfers it inserts an OUT and IN pair in one database transaction.
CREATE OR REPLACE FUNCTION record_inventory_transaction(
  p_item_id uuid,
  p_type text,
  p_quantity numeric,
  p_created_by uuid,
  p_domain text DEFAULT 'uncategorized',
  p_organization_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_destination_warehouse_id uuid DEFAULT NULL,
  p_destination_location_id uuid DEFAULT NULL,
  p_adjustment_direction text DEFAULT NULL,
  p_is_wastage boolean DEFAULT false,
  p_reference text DEFAULT NULL,
  p_remarks text DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_linked_requisition_id uuid DEFAULT NULL,
  p_linked_gate_pass_id uuid DEFAULT NULL,
  p_linked_batch_id uuid DEFAULT NULL,
  p_block_id uuid DEFAULT NULL,
  p_transfer_from_block_id uuid DEFAULT NULL,
  p_transfer_to_block_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid AS $$
DECLARE
  v_item_domain text;
  v_available numeric;
  v_movement_id uuid;
  v_transfer_group uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero' USING ERRCODE = '22023';
  END IF;
  IF p_type NOT IN ('in', 'out', 'adjustment', 'transfer') THEN
    RAISE EXCEPTION 'Unsupported inventory transaction type: %', p_type USING ERRCODE = '22023';
  END IF;
  IF p_domain NOT IN ('civil', 'structural', 'uncategorized') THEN
    RAISE EXCEPTION 'Unsupported inventory domain: %', p_domain USING ERRCODE = '22023';
  END IF;

  SELECT domain INTO v_item_domain
  FROM inventory_items
  WHERE id = p_item_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % does not exist', p_item_id USING ERRCODE = '23503';
  END IF;
  IF v_item_domain IN ('civil', 'structural') AND p_domain = 'uncategorized' THEN
    p_domain := v_item_domain;
  ELSIF v_item_domain IN ('civil', 'structural') AND p_domain <> v_item_domain THEN
    RAISE EXCEPTION 'Transaction domain does not match item domain' USING ERRCODE = '23514';
  END IF;

  IF p_organization_id IS NULL THEN
    SELECT organization_id INTO p_organization_id
    FROM inventory_items
    WHERE id = p_item_id;
  END IF;

  -- Advisory transaction locks serialize concurrent mutations for the same
  -- item and stock scope without introducing a denormalized stock counter.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_item_id::text || ':' || COALESCE(p_warehouse_id::text, 'global') || ':' || COALESCE(p_location_id::text, 'global'),
      0
    )
  );

  SELECT
    CASE WHEN p_warehouse_id IS NULL AND p_location_id IS NULL THEN i.opening_stock ELSE 0 END
    + COALESCE(SUM(
      CASE
        WHEN t.type = 'in' AND t.reversed = false THEN t.quantity
        WHEN t.type = 'out' AND t.reversed = false THEN -t.quantity
        WHEN t.type = 'adjustment' AND t.reversed = false AND t.adjustment_direction = 'up' THEN t.quantity
        WHEN t.type = 'adjustment' AND t.reversed = false AND t.adjustment_direction = 'down' THEN -t.quantity
        ELSE 0
      END
    ), 0)
  INTO v_available
  FROM inventory_items i
  LEFT JOIN inventory_transactions t
    ON t.item_id = i.id
   AND t.warehouse_id IS NOT DISTINCT FROM p_warehouse_id
   AND t.location_id IS NOT DISTINCT FROM p_location_id
  WHERE i.id = p_item_id
  GROUP BY i.opening_stock;

  IF p_type = 'transfer' THEN
    IF p_destination_warehouse_id IS NULL AND p_destination_location_id IS NULL THEN
      RAISE EXCEPTION 'Transfer destination is required' USING ERRCODE = '22023';
    END IF;
    IF p_warehouse_id IS NOT DISTINCT FROM p_destination_warehouse_id
       AND p_location_id IS NOT DISTINCT FROM p_destination_location_id THEN
      RAISE EXCEPTION 'Transfer source and destination must differ' USING ERRCODE = '22023';
    END IF;
    IF v_available < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock: available %, requested %', v_available, p_quantity USING ERRCODE = '23514';
    END IF;

    v_transfer_group := uuid_generate_v4();
    INSERT INTO inventory_transactions (
      item_id, type, quantity, domain, organization_id, warehouse_id, location_id,
      block_id, transfer_from_block_id, transfer_to_block_id,
      destination_warehouse_id, destination_location_id, transfer_group_id,
      linked_requisition_id, linked_gate_pass_id, linked_batch_id,
      reference, remarks, unit_cost, reference_type, reference_id, metadata, created_by
    ) VALUES (
      p_item_id, 'out', p_quantity, p_domain, p_organization_id, p_warehouse_id, p_location_id,
      p_block_id, p_transfer_from_block_id, p_transfer_to_block_id,
      p_destination_warehouse_id, p_destination_location_id, v_transfer_group,
      p_linked_requisition_id, p_linked_gate_pass_id, p_linked_batch_id,
      p_reference, p_remarks, COALESCE(p_unit_cost, 0), p_reference_type, p_reference_id, p_metadata, p_created_by
    ) RETURNING id INTO v_movement_id;

    INSERT INTO inventory_transactions (
      item_id, type, quantity, domain, organization_id, warehouse_id, location_id,
      block_id, transfer_group_id, linked_requisition_id, linked_gate_pass_id, linked_batch_id,
      reference, remarks, unit_cost, reference_type, reference_id, metadata, created_by
    ) VALUES (
      p_item_id, 'in', p_quantity, p_domain, p_organization_id, p_destination_warehouse_id, p_destination_location_id,
      p_block_id, v_transfer_group, p_linked_requisition_id, p_linked_gate_pass_id, p_linked_batch_id,
      p_reference, p_remarks, COALESCE(p_unit_cost, 0), p_reference_type, p_reference_id, p_metadata, p_created_by
    );
    RETURN v_movement_id;
  END IF;

  IF p_type = 'out' OR (p_type = 'adjustment' AND p_adjustment_direction = 'down') THEN
    IF v_available < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock: available %, requested %', v_available, p_quantity USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO inventory_transactions (
    item_id, type, quantity, domain, organization_id, warehouse_id, location_id,
    block_id, transfer_from_block_id, transfer_to_block_id,
    adjustment_direction, is_wastage, linked_requisition_id, linked_gate_pass_id, linked_batch_id,
    reference, remarks, unit_cost, reference_type, reference_id, metadata, created_by
  ) VALUES (
    p_item_id, p_type, p_quantity, p_domain, p_organization_id, p_warehouse_id, p_location_id,
    p_block_id, p_transfer_from_block_id, p_transfer_to_block_id,
    p_adjustment_direction, p_is_wastage, p_linked_requisition_id, p_linked_gate_pass_id, p_linked_batch_id,
    p_reference, p_remarks, COALESCE(p_unit_cost, 0), p_reference_type, p_reference_id, p_metadata, p_created_by
  ) RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION record_inventory_transaction(
  uuid, text, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid, text, boolean,
  text, text, numeric, text, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_inventory_transaction(
  uuid, text, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid, text, boolean,
  text, text, numeric, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
) TO service_role;

-- Atomic full reversal for the legacy reversal endpoint. Partial reversals are
-- intentionally deferred to the consumption/reversal batch where remaining
-- reversible quantity is modeled explicitly.
CREATE OR REPLACE FUNCTION reverse_inventory_transaction(
  p_transaction_id uuid,
  p_created_by uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_original inventory_transactions%ROWTYPE;
  v_reversal_id uuid;
  v_type text;
  v_adjustment_direction text;
BEGIN
  SELECT * INTO v_original
  FROM inventory_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % does not exist', p_transaction_id USING ERRCODE = '23503';
  END IF;
  IF v_original.reversed THEN
    RAISE EXCEPTION 'Transaction is already reversed' USING ERRCODE = '23514';
  END IF;
  IF v_original.is_reversal THEN
    RAISE EXCEPTION 'A reversal transaction cannot be reversed' USING ERRCODE = '23514';
  END IF;

  IF v_original.type = 'in' THEN
    v_type := 'out';
  ELSIF v_original.type = 'out' THEN
    v_type := 'in';
  ELSIF v_original.type = 'adjustment' THEN
    v_type := 'adjustment';
    v_adjustment_direction := CASE WHEN v_original.adjustment_direction = 'up' THEN 'down' ELSE 'up' END;
  ELSE
    v_type := 'transfer';
  END IF;

  v_reversal_id := record_inventory_transaction(
    v_original.item_id,
    v_type,
    v_original.quantity,
    p_created_by,
    v_original.domain,
    v_original.organization_id,
    CASE WHEN v_type = 'transfer' THEN v_original.destination_warehouse_id ELSE v_original.warehouse_id END,
    CASE WHEN v_type = 'transfer' THEN v_original.destination_location_id ELSE v_original.location_id END,
    CASE WHEN v_type = 'transfer' THEN v_original.warehouse_id ELSE NULL END,
    CASE WHEN v_type = 'transfer' THEN v_original.location_id ELSE NULL END,
    v_adjustment_direction,
    false,
    'REVERSAL of tx ' || left(v_original.id::text, 8),
    COALESCE(p_reason, 'Reversal of ' || v_original.type || ' transaction'),
    v_original.unit_cost,
    'inventory_transaction',
    v_original.id,
    v_original.linked_requisition_id,
    v_original.linked_gate_pass_id,
    v_original.linked_batch_id,
    v_original.block_id,
    v_original.transfer_to_block_id,
    v_original.transfer_from_block_id,
    jsonb_build_object('reverses_transaction_id', v_original.id)
  );

  IF v_original.type = 'transfer' THEN
    UPDATE inventory_transactions
    SET is_reversal = true,
        reverses_tx_id = v_original.id
    WHERE transfer_group_id = (
      SELECT transfer_group_id FROM inventory_transactions WHERE id = v_reversal_id
    );
  ELSE
    UPDATE inventory_transactions
    SET is_reversal = true,
        reverses_tx_id = v_original.id
    WHERE id = v_reversal_id;
  END IF;

  UPDATE inventory_transactions
  SET reversed = true,
      reversed_by = p_created_by,
      reversed_at = now(),
      reversal_tx_id = v_reversal_id
  WHERE id = v_original.id;

  RETURN v_reversal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION reverse_inventory_transaction(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reverse_inventory_transaction(uuid, uuid, text) TO service_role;
