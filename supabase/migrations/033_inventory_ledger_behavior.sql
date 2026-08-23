-- ============================================================================
-- Meditrust ERP — Inventory Ledger Behavior
-- Batch 2: movement semantics, scoped balances, atomic transfers, and partial
-- reversals. Existing inventory_transactions remains the canonical ledger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Movement semantics
-- ----------------------------------------------------------------------------
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS transaction_kind text NOT NULL DEFAULT 'movement';
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS reason_code text;

ALTER TABLE inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_kind_check;
ALTER TABLE inventory_transactions
  ADD CONSTRAINT inventory_transactions_kind_check
  CHECK (transaction_kind IN ('movement', 'receipt', 'issue', 'adjustment', 'return', 'transfer', 'reversal'));

CREATE INDEX IF NOT EXISTS idx_inventory_tx_kind_date
  ON inventory_transactions(transaction_kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_reason
  ON inventory_transactions(reason_code)
  WHERE reason_code IS NOT NULL;

-- A reversal can be partial and is never represented by deleting or editing
-- the original ledger row.
CREATE TABLE IF NOT EXISTS inventory_transaction_reversals (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_transaction_id uuid NOT NULL REFERENCES inventory_transactions(id) ON DELETE RESTRICT,
  reversal_transaction_id uuid NOT NULL REFERENCES inventory_transactions(id) ON DELETE RESTRICT,
  quantity              numeric NOT NULL CHECK (quantity > 0),
  reason                text,
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (original_transaction_id, reversal_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_reversals_original
  ON inventory_transaction_reversals(original_transaction_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_reversals_reversal
  ON inventory_transaction_reversals(reversal_transaction_id);

-- Extend the Batch 1 trigger with movement semantics. Existing callers that do
-- not provide metadata remain valid and are classified from the ledger type.
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
  NEW.transaction_kind := COALESCE(
    NULLIF(NEW.metadata ->> 'transaction_kind', ''),
    CASE
      WHEN NEW.is_reversal THEN 'reversal'
      WHEN NEW.type = 'adjustment' THEN 'adjustment'
      WHEN NEW.type = 'transfer' THEN 'transfer'
      WHEN NEW.type = 'in' THEN 'receipt'
      ELSE 'issue'
    END
  );
  NEW.reason_code := COALESCE(NEW.reason_code, NEW.metadata ->> 'reason_code');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Scoped balance view
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW inventory_stock_balances AS
WITH scopes AS (
  SELECT i.id AS item_id, NULL::uuid AS warehouse_id, NULL::uuid AS location_id
  FROM inventory_items i
  UNION
  SELECT DISTINCT item_id, warehouse_id, location_id
  FROM inventory_transactions
  WHERE warehouse_id IS NOT NULL OR location_id IS NOT NULL
), movements AS (
  SELECT
    s.item_id,
    s.warehouse_id,
    s.location_id,
    CASE
      WHEN s.warehouse_id IS NULL AND s.location_id IS NULL THEN i.opening_stock
      ELSE 0
    END
    + COALESCE(SUM(
      CASE
        WHEN t.type = 'in' AND NOT t.reversed THEN t.quantity
        WHEN t.type = 'out' AND NOT t.reversed THEN -t.quantity
        WHEN t.type = 'adjustment' AND NOT t.reversed AND t.adjustment_direction = 'up' THEN t.quantity
        WHEN t.type = 'adjustment' AND NOT t.reversed AND t.adjustment_direction = 'down' THEN -t.quantity
        ELSE 0
      END
    ), 0) AS current_stock,
    COALESCE(SUM(
      CASE
        WHEN t.type IN ('in', 'out') AND NOT t.reversed THEN t.quantity * t.unit_cost
        WHEN t.type = 'adjustment' AND NOT t.reversed AND t.adjustment_direction = 'up' THEN t.quantity * t.unit_cost
        WHEN t.type = 'adjustment' AND NOT t.reversed AND t.adjustment_direction = 'down' THEN -t.quantity * t.unit_cost
        ELSE 0
      END
    ), 0) AS movement_value
  FROM scopes s
  JOIN inventory_items i ON i.id = s.item_id
  LEFT JOIN inventory_transactions t
    ON t.item_id = s.item_id
   AND t.warehouse_id IS NOT DISTINCT FROM s.warehouse_id
   AND t.location_id IS NOT DISTINCT FROM s.location_id
  GROUP BY i.id, i.opening_stock, s.warehouse_id, s.location_id
)
SELECT
  m.item_id,
  i.name AS item_name,
  i.unit_of_measure,
  i.category_id,
  i.domain,
  i.organization_id,
  i.reorder_level,
  i.reorder_qty,
  m.warehouse_id,
  m.location_id,
  m.current_stock,
  CASE
    WHEN m.current_stock = 0 THEN 0
    ELSE m.movement_value / NULLIF(m.current_stock, 0)
  END AS weighted_unit_cost,
  m.movement_value AS stock_value,
  i.archived
FROM movements m
JOIN inventory_items i ON i.id = m.item_id;

CREATE INDEX IF NOT EXISTS idx_inventory_tx_scope_balance
  ON inventory_transactions(item_id, warehouse_id, location_id, reversed);

-- ----------------------------------------------------------------------------
-- Transfer-specific lock wrapper
-- ----------------------------------------------------------------------------
-- The generic Batch 1 function creates the paired rows. This wrapper locks both
-- scopes in deterministic order first, preventing transfer-vs-issue races on
-- either side of a transfer.
CREATE OR REPLACE FUNCTION record_inventory_transfer(
  p_item_id uuid,
  p_quantity numeric,
  p_created_by uuid,
  p_domain text DEFAULT 'uncategorized',
  p_organization_id uuid DEFAULT NULL,
  p_source_warehouse_id uuid DEFAULT NULL,
  p_source_location_id uuid DEFAULT NULL,
  p_destination_warehouse_id uuid DEFAULT NULL,
  p_destination_location_id uuid DEFAULT NULL,
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
  source_key bigint;
  destination_key bigint;
BEGIN
  source_key := hashtextextended(
    p_item_id::text || ':' || COALESCE(p_source_warehouse_id::text, 'global') || ':' || COALESCE(p_source_location_id::text, 'global'),
    0
  );
  destination_key := hashtextextended(
    p_item_id::text || ':' || COALESCE(p_destination_warehouse_id::text, 'global') || ':' || COALESCE(p_destination_location_id::text, 'global'),
    0
  );

  IF source_key <= destination_key THEN
    PERFORM pg_advisory_xact_lock(source_key);
    PERFORM pg_advisory_xact_lock(destination_key);
  ELSE
    PERFORM pg_advisory_xact_lock(destination_key);
    PERFORM pg_advisory_xact_lock(source_key);
  END IF;

  RETURN record_inventory_transaction(
    p_item_id, 'transfer', p_quantity, p_created_by, p_domain, p_organization_id,
    p_source_warehouse_id, p_source_location_id, p_destination_warehouse_id,
    p_destination_location_id, NULL, false, p_reference, p_remarks, p_unit_cost,
    p_reference_type, p_reference_id, p_linked_requisition_id, p_linked_gate_pass_id,
    p_linked_batch_id, p_block_id, p_transfer_from_block_id, p_transfer_to_block_id,
    jsonb_build_object('transaction_kind', 'transfer') || COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION record_inventory_transfer(
  uuid, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid, text, text, numeric,
  text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_inventory_transfer(
  uuid, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid, text, text, numeric,
  text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
) TO service_role;

-- ----------------------------------------------------------------------------
-- Partial/full reversal function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_inventory_transaction(
  p_transaction_id uuid,
  p_created_by uuid,
  p_reason text DEFAULT NULL,
  p_quantity numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  original_tx inventory_transactions%ROWTYPE;
  reversal_id uuid;
  requested numeric;
  reversed_quantity numeric;
  reversal_type text;
  reversal_direction text;
BEGIN
  SELECT * INTO original_tx
  FROM inventory_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % does not exist', p_transaction_id USING ERRCODE = '23503';
  END IF;
  IF original_tx.is_reversal THEN
    RAISE EXCEPTION 'A reversal transaction cannot be reversed' USING ERRCODE = '23514';
  END IF;

  -- Normalize a transfer destination row to its source row so either side of
  -- the paired ledger entry can be selected for reversal.
  IF original_tx.transfer_group_id IS NOT NULL THEN
    SELECT * INTO original_tx
    FROM inventory_transactions
    WHERE transfer_group_id = original_tx.transfer_group_id
      AND type = 'out'
    FOR UPDATE;
  END IF;

  requested := COALESCE(p_quantity, original_tx.quantity);
  IF requested <= 0 OR requested > original_tx.quantity THEN
    RAISE EXCEPTION 'Reversal quantity must be greater than zero and no more than the original quantity' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO reversed_quantity
  FROM inventory_transaction_reversals
  WHERE original_transaction_id = original_tx.id;
  IF reversed_quantity + requested > original_tx.quantity THEN
    RAISE EXCEPTION 'Reversal exceeds remaining reversible quantity' USING ERRCODE = '23514';
  END IF;

  IF original_tx.transfer_group_id IS NULL AND original_tx.type = 'in' THEN
    reversal_type := 'out';
  ELSIF original_tx.transfer_group_id IS NULL AND original_tx.type = 'out' THEN
    reversal_type := 'in';
  ELSIF original_tx.transfer_group_id IS NULL AND original_tx.type = 'adjustment' THEN
    reversal_type := 'adjustment';
    reversal_direction := CASE WHEN original_tx.adjustment_direction = 'up' THEN 'down' ELSE 'up' END;
  ELSIF original_tx.transfer_group_id IS NULL THEN
    RAISE EXCEPTION 'Unsupported reversal source transaction type' USING ERRCODE = '22023';
  END IF;

  IF original_tx.transfer_group_id IS NOT NULL THEN
    reversal_id := record_inventory_transfer(
      original_tx.item_id,
      requested,
      p_created_by,
      original_tx.domain,
      original_tx.organization_id,
      original_tx.warehouse_id,
      original_tx.location_id,
      original_tx.destination_warehouse_id,
      original_tx.destination_location_id,
      'REVERSAL of tx ' || left(original_tx.id::text, 8),
      COALESCE(p_reason, 'Reversal of transfer transaction'),
      original_tx.unit_cost,
      'inventory_transaction',
      original_tx.id,
      original_tx.linked_requisition_id,
      original_tx.linked_gate_pass_id,
      original_tx.linked_batch_id,
      original_tx.block_id,
      original_tx.transfer_to_block_id,
      original_tx.transfer_from_block_id,
      jsonb_build_object('transaction_kind', 'reversal', 'reason_code', 'reversal')
    );
  ELSE
    reversal_id := record_inventory_transaction(
    original_tx.item_id,
    reversal_type,
    requested,
    p_created_by,
    original_tx.domain,
    original_tx.organization_id,
    original_tx.warehouse_id,
    original_tx.location_id,
    NULL,
    NULL,
    reversal_direction,
    false,
    'REVERSAL of tx ' || left(original_tx.id::text, 8),
    COALESCE(p_reason, 'Reversal of ' || original_tx.type || ' transaction'),
    original_tx.unit_cost,
    'inventory_transaction',
    original_tx.id,
    original_tx.linked_requisition_id,
    original_tx.linked_gate_pass_id,
    original_tx.linked_batch_id,
    original_tx.block_id,
    NULL,
    NULL,
    jsonb_build_object('transaction_kind', 'reversal', 'reason_code', 'reversal')
  );

  INSERT INTO inventory_transaction_reversals (
    original_transaction_id, reversal_transaction_id, quantity, reason, created_by
  ) VALUES (
    original_tx.id, reversal_id, requested, p_reason, p_created_by
  );

  IF reversed_quantity + requested = original_tx.quantity THEN
    UPDATE inventory_transactions
    SET reversed = true,
        reversed_by = p_created_by,
        reversed_at = now(),
        reversal_tx_id = reversal_id
    WHERE id = original_tx.id;
  END IF;

  IF original_tx.transfer_group_id IS NOT NULL THEN
    UPDATE inventory_transactions
    SET is_reversal = true,
        reverses_tx_id = original_tx.id
    WHERE transfer_group_id = (
      SELECT transfer_group_id FROM inventory_transactions WHERE id = reversal_id
    );
  ELSE
    UPDATE inventory_transactions
    SET is_reversal = true,
        reverses_tx_id = original_tx.id
    WHERE id = reversal_id;
  END IF;

  RETURN reversal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Preserve the existing three-argument RPC contract.
CREATE OR REPLACE FUNCTION reverse_inventory_transaction(
  p_transaction_id uuid,
  p_created_by uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid AS $$
BEGIN
  RETURN reverse_inventory_transaction(p_transaction_id, p_created_by, p_reason, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION reverse_inventory_transaction(uuid, uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reverse_inventory_transaction(uuid, uuid, text, numeric) TO service_role;
REVOKE ALL ON FUNCTION reverse_inventory_transaction(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reverse_inventory_transaction(uuid, uuid, text) TO service_role;
