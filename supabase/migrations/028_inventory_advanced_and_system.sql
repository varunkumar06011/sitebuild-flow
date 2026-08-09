-- 022_inventory_advanced_and_system.sql
-- Inventory: warehouses, transfer transactions, reversal mechanism, stock valuation.
-- System: notification queue (SMS/WhatsApp/Email), backup log, role change audit view.

-- ============================================================================
-- INVENTORY: Warehouses / Storage Locations
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_warehouses (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  code        text UNIQUE,
  location    text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Link items to a default warehouse (optional — null means shared/default)
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS default_warehouse_id uuid REFERENCES inventory_warehouses(id) ON DELETE SET NULL;

-- Link transactions to a specific warehouse
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES inventory_warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_tx_warehouse ON inventory_transactions(warehouse_id) WHERE warehouse_id IS NOT NULL;

-- ============================================================================
-- INVENTORY: Transfer transactions (from_block → to_block)
-- ============================================================================
-- Add 'transfer' to the type check constraint
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_type_check;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_type_check
  CHECK (type IN ('in','out','adjustment','transfer'));

-- For transfers: source and destination
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS transfer_from_block_id uuid REFERENCES progress_blocks(id) ON DELETE SET NULL;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS transfer_to_block_id uuid REFERENCES progress_blocks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_tx_transfer_from ON inventory_transactions(transfer_from_block_id) WHERE transfer_from_block_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_tx_transfer_to ON inventory_transactions(transfer_to_block_id) WHERE transfer_to_block_id IS NOT NULL;

-- ============================================================================
-- INVENTORY: Transaction reversal mechanism
-- ============================================================================
-- A reversal links a compensating transaction to the original.
-- The original transaction is marked as reversed (but NOT deleted — immutability preserved).
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reversed boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES users(id);
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reversal_tx_id uuid REFERENCES inventory_transactions(id);
-- is_reversal: true if this transaction IS a reversal entry (compensating)
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS is_reversal boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reverses_tx_id uuid REFERENCES inventory_transactions(id);

CREATE INDEX IF NOT EXISTS idx_inventory_tx_reversed ON inventory_transactions(reversed) WHERE reversed = true;

-- ============================================================================
-- INVENTORY: Stock valuation / cost tracking
-- ============================================================================
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;

-- ============================================================================
-- INVENTORY: Update stock levels view to handle transfers and reversals
-- ============================================================================
DROP VIEW IF EXISTS inventory_stock_levels;
CREATE OR REPLACE VIEW inventory_stock_levels AS
SELECT
  i.id AS item_id,
  i.name AS item_name,
  i.unit_of_measure,
  i.reorder_level,
  i.unit_cost,
  i.default_warehouse_id,
  i.opening_stock,
  i.category_id,
  i.opening_stock
    + COALESCE(SUM(CASE WHEN t.type = 'in'          AND NOT t.reversed THEN t.quantity ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN t.type = 'out'         AND NOT t.reversed THEN t.quantity ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN t.type = 'adjustment'  AND NOT t.reversed THEN t.quantity ELSE 0 END), 0)
    AS current_stock,
  (i.opening_stock
    + COALESCE(SUM(CASE WHEN t.type = 'in'          AND NOT t.reversed THEN t.quantity ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN t.type = 'out'         AND NOT t.reversed THEN t.quantity ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN t.type = 'adjustment'  AND NOT t.reversed THEN t.quantity ELSE 0 END), 0)
  ) * i.unit_cost AS stock_value
FROM inventory_items i
LEFT JOIN inventory_transactions t ON t.item_id = i.id
GROUP BY i.id, i.name, i.unit_of_measure, i.reorder_level, i.unit_cost, i.default_warehouse_id, i.opening_stock, i.category_id;

-- ============================================================================
-- SYSTEM: Notification queue (for SMS / WhatsApp / Email delivery)
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_queue (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('sms','whatsapp','email','in_app')),
  recipient     text NOT NULL,  -- phone number, email, or user_id
  subject       text,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','delivered')),
  provider      text,           -- 'twilio', 'gupshup', 'ses', etc.
  provider_msg_id text,
  error         text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 3,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notif_queue_status ON notification_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notif_queue_user ON notification_queue(user_id);

-- User notification preferences (opt-in per channel per event type)
CREATE TABLE IF NOT EXISTS notification_preferences (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  text NOT NULL,   -- 'approval_pending', 'gate_pass_otp', 'low_stock', 'payment_recorded', etc.
  sms         boolean NOT NULL DEFAULT false,
  whatsapp    boolean NOT NULL DEFAULT false,
  email       boolean NOT NULL DEFAULT false,
  in_app      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_type)
);

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_queue FROM anon, authenticated;
REVOKE ALL ON notification_preferences FROM anon, authenticated;
REVOKE ALL ON inventory_warehouses FROM anon, authenticated;

-- ============================================================================
-- SYSTEM: Backup log (tracks manual and scheduled backup verification)
-- ============================================================================
CREATE TABLE IF NOT EXISTS backup_log (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  backup_type     text NOT NULL CHECK (backup_type IN ('manual','scheduled')),
  tables_count    int NOT NULL DEFAULT 0,
  total_rows      int NOT NULL DEFAULT 0,
  file_size_bytes bigint,
  status          text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed','verified')),
  triggered_by    uuid REFERENCES users(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_log_created ON backup_log(created_at);

ALTER TABLE backup_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_log FROM anon, authenticated;

-- ============================================================================
-- SYSTEM: Role change audit view (filters audit_log for role-related actions)
-- ============================================================================
CREATE OR REPLACE VIEW role_change_audit AS
SELECT
  a.id,
  a.user_id,
  u.name AS user_name,
  u.role AS current_role,
  a.action,
  a.entity_type,
  a.entity_id,
  a.details,
  a.created_at,
  actor.name AS actor_name
FROM audit_log a
JOIN users u ON u.id = a.user_id
LEFT JOIN users actor ON actor.id = a.user_id
WHERE a.action IN ('create_user','update_user','delete_user','role_change','unlock_user')
  AND a.entity_type = 'user'
ORDER BY a.created_at DESC;

-- ============================================================================
-- Seed: default warehouse
-- ============================================================================
INSERT INTO inventory_warehouses (name, code, location, created_by)
SELECT 'Main Store', 'MAIN', 'Site Office', id FROM users LIMIT 1
ON CONFLICT DO NOTHING;
