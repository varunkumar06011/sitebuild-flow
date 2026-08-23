-- ============================================================================
-- Meditrust ERP — Inventory Reports
-- Batch 8: derived report views over the canonical ledger and receipt data.
-- ============================================================================

CREATE OR REPLACE VIEW inventory_daily_register AS
WITH days AS (
  SELECT DISTINCT
    item_id,
    warehouse_id,
    location_id,
    occurred_at::date AS report_date
  FROM inventory_transactions
), daily AS (
  SELECT
    d.item_id,
    d.warehouse_id,
    d.location_id,
    d.report_date,
    COALESCE(SUM(CASE WHEN t.type = 'in' AND NOT t.reversed THEN t.quantity ELSE 0 END), 0) AS received_quantity,
    COALESCE(SUM(CASE WHEN t.type = 'out' AND NOT t.reversed AND NOT t.is_wastage THEN t.quantity ELSE 0 END), 0) AS issued_quantity,
    COALESCE(SUM(CASE WHEN t.type = 'out' AND NOT t.reversed AND t.is_wastage THEN t.quantity ELSE 0 END), 0) AS wasted_quantity,
    COALESCE(SUM(CASE WHEN t.type = 'adjustment' AND NOT t.reversed AND t.adjustment_direction = 'up' THEN t.quantity ELSE 0 END), 0) AS adjustment_in_quantity,
    COALESCE(SUM(CASE WHEN t.type = 'adjustment' AND NOT t.reversed AND t.adjustment_direction = 'down' THEN t.quantity ELSE 0 END), 0) AS adjustment_out_quantity
  FROM days d
  LEFT JOIN inventory_transactions t
    ON t.item_id = d.item_id
   AND t.warehouse_id IS NOT DISTINCT FROM d.warehouse_id
   AND t.location_id IS NOT DISTINCT FROM d.location_id
   AND t.occurred_at::date = d.report_date
  GROUP BY d.item_id, d.warehouse_id, d.location_id, d.report_date
)
SELECT
  d.*,
  i.name AS item_name,
  i.unit_of_measure,
  i.domain,
  i.organization_id,
  CASE WHEN d.warehouse_id IS NULL AND d.location_id IS NULL THEN i.opening_stock ELSE 0 END
    + COALESCE((
      SELECT SUM(
        CASE
          WHEN t2.type = 'in' AND NOT t2.reversed THEN t2.quantity
          WHEN t2.type = 'out' AND NOT t2.reversed THEN -t2.quantity
          WHEN t2.type = 'adjustment' AND NOT t2.reversed AND t2.adjustment_direction = 'up' THEN t2.quantity
          WHEN t2.type = 'adjustment' AND NOT t2.reversed AND t2.adjustment_direction = 'down' THEN -t2.quantity
          ELSE 0
        END
      )
      FROM inventory_transactions t2
      WHERE t2.item_id = d.item_id
        AND t2.warehouse_id IS NOT DISTINCT FROM d.warehouse_id
        AND t2.location_id IS NOT DISTINCT FROM d.location_id
        AND t2.occurred_at::date < d.report_date
    ), 0) AS opening_quantity,
  CASE WHEN d.warehouse_id IS NULL AND d.location_id IS NULL THEN i.opening_stock ELSE 0 END
    + COALESCE((
      SELECT SUM(
        CASE
          WHEN t2.type = 'in' AND NOT t2.reversed THEN t2.quantity
          WHEN t2.type = 'out' AND NOT t2.reversed THEN -t2.quantity
          WHEN t2.type = 'adjustment' AND NOT t2.reversed AND t2.adjustment_direction = 'up' THEN t2.quantity
          WHEN t2.type = 'adjustment' AND NOT t2.reversed AND t2.adjustment_direction = 'down' THEN -t2.quantity
          ELSE 0
        END
      )
      FROM inventory_transactions t2
      WHERE t2.item_id = d.item_id
        AND t2.warehouse_id IS NOT DISTINCT FROM d.warehouse_id
        AND t2.location_id IS NOT DISTINCT FROM d.location_id
        AND t2.occurred_at::date <= d.report_date
    ), 0) AS closing_quantity
FROM daily d
JOIN inventory_items i ON i.id = d.item_id;

CREATE OR REPLACE VIEW inventory_vendor_purchase_report AS
SELECT
  r.id AS receipt_id,
  r.requisition_id,
  r.item_id,
  i.name AS item_name,
  i.domain,
  r.vendor_id,
  v.name AS vendor_name,
  r.po_number,
  r.grn_number,
  r.invoice_number,
  r.quantity,
  r.unit_cost,
  r.total_cost,
  r.warehouse_id,
  r.location_id,
  r.received_at,
  r.received_by
FROM inventory_receipts r
JOIN inventory_items i ON i.id = r.item_id
LEFT JOIN vendors v ON v.id = r.vendor_id;

CREATE OR REPLACE VIEW inventory_transfer_report AS
SELECT
  t.transfer_group_id,
  t.item_id,
  i.name AS item_name,
  i.domain,
  t.quantity,
  t.unit_cost,
  t.warehouse_id AS source_warehouse_id,
  t.location_id AS source_location_id,
  t.destination_warehouse_id,
  t.destination_location_id,
  t.created_by,
  t.occurred_at,
  t.reference,
  t.remarks
FROM inventory_transactions t
JOIN inventory_items i ON i.id = t.item_id
WHERE t.transfer_group_id IS NOT NULL
  AND t.type = 'out';
