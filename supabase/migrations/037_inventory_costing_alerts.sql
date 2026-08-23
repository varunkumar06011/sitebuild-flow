-- ============================================================================
-- Meditrust ERP — Inventory Costing and Alerts
-- Batch 6: weighted-average costing, valuation, reorder/budget alerts, missing
-- cost, and high-wastage detection.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Weighted-average cost helpers and summary
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory_weighted_average_cost(
  p_item_id uuid,
  p_warehouse_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
)
RETURNS numeric AS $$
DECLARE
  weighted_cost numeric;
  fallback_cost numeric;
BEGIN
  SELECT SUM(t.quantity * t.unit_cost) / NULLIF(SUM(t.quantity), 0)
  INTO weighted_cost
  FROM inventory_transactions t
  WHERE t.item_id = p_item_id
    AND t.type IN ('in', 'adjustment')
    AND NOT t.reversed
    AND (t.type = 'in' OR t.adjustment_direction = 'up')
    AND t.warehouse_id IS NOT DISTINCT FROM p_warehouse_id
    AND t.location_id IS NOT DISTINCT FROM p_location_id
    AND t.unit_cost > 0;

  SELECT unit_cost INTO fallback_cost FROM inventory_items WHERE id = p_item_id;
  RETURN COALESCE(weighted_cost, NULLIF(fallback_cost, 0), 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE VIEW inventory_cost_summary AS
SELECT
  b.item_id,
  b.item_name,
  b.domain,
  b.organization_id,
  b.warehouse_id,
  b.location_id,
  b.current_stock,
  inventory_weighted_average_cost(b.item_id, b.warehouse_id, b.location_id) AS weighted_unit_cost,
  b.current_stock * inventory_weighted_average_cost(b.item_id, b.warehouse_id, b.location_id) AS stock_value,
  b.archived
FROM inventory_stock_balances b;

-- Fill missing movement costs at the database boundary. Transfer destination
-- rows inherit the source cost from their already-created paired row.
CREATE OR REPLACE FUNCTION validate_inventory_transaction_context()
RETURNS trigger AS $$
DECLARE
  item_domain text;
  source_cost numeric;
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

  IF COALESCE(NEW.unit_cost, 0) <= 0 AND NEW.transfer_group_id IS NOT NULL THEN
    SELECT unit_cost INTO source_cost
    FROM inventory_transactions
    WHERE transfer_group_id = NEW.transfer_group_id
      AND type = 'out'
    ORDER BY created_at
    LIMIT 1;
    NEW.unit_cost := COALESCE(source_cost, 0);
  END IF;
  IF COALESCE(NEW.unit_cost, 0) <= 0 AND NEW.type IN ('out', 'adjustment') THEN
    NEW.unit_cost := inventory_weighted_average_cost(NEW.item_id, NEW.warehouse_id, NEW.location_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Alert model extensions
-- ----------------------------------------------------------------------------
ALTER TABLE inventory_alerts
  ADD COLUMN IF NOT EXISTS alert_type text NOT NULL DEFAULT 'LOW_STOCK';
ALTER TABLE inventory_alerts
  ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT 'uncategorized';
ALTER TABLE inventory_alerts
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES inventory_warehouses(id) ON DELETE SET NULL;
ALTER TABLE inventory_alerts
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES inventory_locations(id) ON DELETE SET NULL;
ALTER TABLE inventory_alerts
  ADD COLUMN IF NOT EXISTS threshold_value numeric;
ALTER TABLE inventory_alerts
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE inventory_alerts
  DROP CONSTRAINT IF EXISTS inventory_alerts_type_check;
ALTER TABLE inventory_alerts
  ADD CONSTRAINT inventory_alerts_type_check
  CHECK (alert_type IN ('LOW_STOCK', 'REORDER_REQUIRED', 'BUDGET_THRESHOLD', 'BUDGET_EXCEEDED', 'MISSING_COST', 'HIGH_WASTAGE'));

DROP INDEX IF EXISTS idx_inventory_alerts_open_item;
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_open_scope
  ON inventory_alerts(item_id, alert_type, warehouse_id, location_id)
  WHERE NOT is_resolved;
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_type
  ON inventory_alerts(alert_type, is_resolved, created_at DESC);

ALTER TABLE inventory_budgets
  ADD COLUMN IF NOT EXISTS wastage_threshold_pct numeric NOT NULL DEFAULT 10
  CHECK (wastage_threshold_pct >= 0 AND wastage_threshold_pct <= 100);

-- ----------------------------------------------------------------------------
-- Alert refresh logic
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_inventory_alert(
  p_item_id uuid,
  p_alert_type text,
  p_stock numeric,
  p_threshold numeric,
  p_warehouse_id uuid,
  p_location_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void AS $$
DECLARE
  item_domain text;
  organization_id uuid;
  existing_id uuid;
BEGIN
  SELECT domain, organization_id INTO item_domain, organization_id
  FROM inventory_items WHERE id = p_item_id;

  SELECT id INTO existing_id
  FROM inventory_alerts
  WHERE item_id = p_item_id
    AND alert_type = p_alert_type
    AND warehouse_id IS NOT DISTINCT FROM p_warehouse_id
    AND location_id IS NOT DISTINCT FROM p_location_id
    AND NOT is_resolved
  LIMIT 1;

  IF existing_id IS NULL THEN
    INSERT INTO inventory_alerts (
      item_id, organization_id, domain, alert_type, stock_at_alert,
      reorder_level_at_alert, warehouse_id, location_id, threshold_value, metadata
    ) VALUES (
      p_item_id, organization_id, COALESCE(item_domain, 'uncategorized'), p_alert_type, p_stock,
      p_threshold, p_warehouse_id, p_location_id, p_threshold, COALESCE(p_metadata, '{}'::jsonb)
    );
  ELSE
    UPDATE inventory_alerts
    SET stock_at_alert = p_stock,
        reorder_level_at_alert = p_threshold,
        threshold_value = p_threshold,
        metadata = COALESCE(p_metadata, '{}'::jsonb)
    WHERE id = existing_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION refresh_inventory_alerts_for_item(
  p_item_id uuid,
  p_warehouse_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  item_row inventory_items%ROWTYPE;
  stock numeric;
  weighted_cost numeric;
  consumed numeric;
  wasted numeric;
  budget_row inventory_budgets%ROWTYPE;
  budget_value_actual numeric;
BEGIN
  SELECT * INTO item_row FROM inventory_items WHERE id = p_item_id;
  IF NOT FOUND OR item_row.archived THEN
    RETURN;
  END IF;

  SELECT current_stock INTO stock
  FROM inventory_stock_balances
  WHERE item_id = p_item_id
    AND warehouse_id IS NOT DISTINCT FROM p_warehouse_id
    AND location_id IS NOT DISTINCT FROM p_location_id
  LIMIT 1;
  stock := COALESCE(stock, 0);
  weighted_cost := inventory_weighted_average_cost(p_item_id, p_warehouse_id, p_location_id);

  IF item_row.reorder_level > 0 AND stock <= item_row.reorder_level THEN
    PERFORM upsert_inventory_alert(
      p_item_id, 'LOW_STOCK', stock, item_row.reorder_level,
      p_warehouse_id, p_location_id, jsonb_build_object('reorder_quantity', item_row.reorder_qty)
    );
    IF item_row.reorder_qty > 0 THEN
      PERFORM upsert_inventory_alert(
        p_item_id, 'REORDER_REQUIRED', stock, item_row.reorder_qty,
        p_warehouse_id, p_location_id, jsonb_build_object('reorder_level', item_row.reorder_level)
      );
    END IF;
  END IF;

  IF stock > item_row.reorder_level THEN
    UPDATE inventory_alerts
    SET is_resolved = true, resolved_at = now()
    WHERE item_id = p_item_id
      AND alert_type IN ('LOW_STOCK', 'REORDER_REQUIRED')
      AND warehouse_id IS NOT DISTINCT FROM p_warehouse_id
      AND location_id IS NOT DISTINCT FROM p_location_id
      AND NOT is_resolved;
  END IF;

  IF stock > 0 AND weighted_cost <= 0 THEN
    PERFORM upsert_inventory_alert(
      p_item_id, 'MISSING_COST', stock, 0,
      p_warehouse_id, p_location_id, '{}'::jsonb
    );
  END IF;

  SELECT * INTO budget_row FROM inventory_budgets WHERE item_id = p_item_id LIMIT 1;
  IF FOUND AND budget_row.budget_qty > 0 THEN
    SELECT COALESCE(SUM(t.quantity), 0), COALESCE(SUM(t.quantity * t.unit_cost), 0)
    INTO consumed, budget_value_actual
    FROM inventory_transactions t
    WHERE t.item_id = p_item_id
      AND t.type = 'out'
      AND NOT t.is_wastage
      AND NOT t.reversed
      AND t.warehouse_id IS NOT DISTINCT FROM p_warehouse_id
      AND t.location_id IS NOT DISTINCT FROM p_location_id;

    IF consumed >= budget_row.budget_qty THEN
      PERFORM upsert_inventory_alert(
        p_item_id, 'BUDGET_EXCEEDED', consumed, budget_row.budget_qty,
        p_warehouse_id, p_location_id,
        jsonb_build_object('budget_value', budget_row.budget_value, 'actual_value', budget_value_actual)
      );
    ELSIF consumed >= budget_row.budget_qty * budget_row.alert_threshold_pct / 100 THEN
      PERFORM upsert_inventory_alert(
        p_item_id, 'BUDGET_THRESHOLD', consumed,
        budget_row.budget_qty * budget_row.alert_threshold_pct / 100,
        p_warehouse_id, p_location_id,
        jsonb_build_object('budget_qty', budget_row.budget_qty, 'actual_qty', consumed)
      );
    END IF;
  END IF;

  SELECT COALESCE(SUM(quantity) FILTER (WHERE is_wastage), 0),
         COALESCE(SUM(quantity), 0)
  INTO wasted, consumed
  FROM inventory_transactions
  WHERE item_id = p_item_id
    AND type = 'out'
    AND NOT reversed
    AND warehouse_id IS NOT DISTINCT FROM p_warehouse_id
    AND location_id IS NOT DISTINCT FROM p_location_id;
  IF consumed > 0 AND wasted / consumed * 100 >= COALESCE(budget_row.wastage_threshold_pct, 10) THEN
    PERFORM upsert_inventory_alert(
      p_item_id, 'HIGH_WASTAGE', wasted,
      consumed * COALESCE(budget_row.wastage_threshold_pct, 10) / 100,
      p_warehouse_id, p_location_id,
      jsonb_build_object(
        'wasted_quantity', wasted,
        'out_quantity', consumed,
        'wastage_pct', wasted / consumed * 100,
        'threshold_pct', COALESCE(budget_row.wastage_threshold_pct, 10)
      )
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION check_inventory_low_stock()
RETURNS trigger AS $$
BEGIN
  PERFORM refresh_inventory_alerts_for_item(NEW.item_id, NEW.warehouse_id, NEW.location_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_low_stock_check ON inventory_transactions;
CREATE TRIGGER trg_inventory_low_stock_check
AFTER INSERT ON inventory_transactions
FOR EACH ROW EXECUTE FUNCTION check_inventory_low_stock();
