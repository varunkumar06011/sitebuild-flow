-- 020_portals_and_anomalies.sql
-- Portal accounts (vendor + client), anomaly detection results, and block layout for digital twin.

-- ============================================================================
-- Portal Accounts
-- Separate auth for vendor and client portals — distinct from internal users.
-- ============================================================================
CREATE TABLE IF NOT EXISTS portal_accounts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_type    text NOT NULL CHECK (account_type IN ('vendor', 'client')),
  vendor_id       uuid REFERENCES vendors(id) ON DELETE CASCADE,
  username        text UNIQUE NOT NULL,
  password_hash   text NOT NULL,
  name            text NOT NULL,
  email           text,
  phone           text,
  active          boolean NOT NULL DEFAULT true,
  failed_login_attempts int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_account_has_vendor CHECK (
    (account_type = 'vendor' AND vendor_id IS NOT NULL) OR
    (account_type = 'client')
  )
);

CREATE INDEX IF NOT EXISTS idx_portal_accounts_type ON portal_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_portal_accounts_vendor ON portal_accounts(vendor_id);

-- ============================================================================
-- Portal Sessions
-- Separate session table for portal accounts (different JWT cookie name).
-- ============================================================================
CREATE TABLE IF NOT EXISTS portal_sessions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      uuid NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
  token_hash      text NOT NULL,
  expires_at      timestamptz NOT NULL,
  revoked         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_account ON portal_sessions(account_id);

-- ============================================================================
-- Anomaly Detection Results
-- Stores detected anomalies so they can be reviewed and dismissed.
-- ============================================================================
CREATE TABLE IF NOT EXISTS anomaly_flags (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  anomaly_type    text NOT NULL CHECK (anomaly_type IN ('high_quotation', 'duplicate_invoice', 'gate_pass_anomaly', 'budget_overrun')),
  entity_id       uuid,
  entity_type     text,
  severity        text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  title           text NOT NULL,
  description     text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  dismissed       boolean NOT NULL DEFAULT false,
  dismissed_by    uuid REFERENCES users(id),
  dismissed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_anomaly_type ON anomaly_flags(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_anomaly_dismissed ON anomaly_flags(dismissed) WHERE dismissed = false;
CREATE INDEX IF NOT EXISTS idx_anomaly_severity ON anomaly_flags(severity);

-- ============================================================================
-- Block Layout (for Digital Twin)
-- Stores x/y coordinates and dimensions for blocks to render on the site map.
-- ============================================================================
CREATE TABLE IF NOT EXISTS block_layout (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  block_id        uuid NOT NULL REFERENCES progress_blocks(id) ON DELETE CASCADE,
  x_position      int NOT NULL DEFAULT 0,
  y_position      int NOT NULL DEFAULT 0,
  width           int NOT NULL DEFAULT 1,
  height          int NOT NULL DEFAULT 1,
  color_override  text,
  UNIQUE (block_id)
);

-- ============================================================================
-- RLS Policies
-- ============================================================================
ALTER TABLE portal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE block_layout ENABLE ROW LEVEL SECURITY;

-- Portal accounts: only readable via server functions (no direct client access)
CREATE POLICY "portal_no_direct_access" ON portal_accounts
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "portal_sessions_no_direct_access" ON portal_sessions
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- Anomaly flags: all authenticated users can see
CREATE POLICY "anomaly_read" ON anomaly_flags
  FOR SELECT TO authenticated
  USING (true);

-- Block layout: all authenticated users can see
CREATE POLICY "block_layout_read" ON block_layout
  FOR SELECT TO authenticated
  USING (true);

-- ============================================================================
-- Seed: portal accounts
-- ============================================================================
-- Vendor portal account (linked to first vendor)
INSERT INTO portal_accounts (account_type, vendor_id, username, password_hash, name, email, active)
SELECT 'vendor', v.id, 'vendor1',
  '$2a$10$8K1a/aQkQkQkQkQkQkQkQeQkQkQkQkQkQkQkQkQkQkQkQkQkQkQ',
  v.name, v.email, true
FROM vendors v
WHERE v.id = (SELECT id FROM vendors ORDER BY name LIMIT 1)
ON CONFLICT DO NOTHING;

-- Client portal account
INSERT INTO portal_accounts (account_type, username, password_hash, name, email, active)
SELECT 'client', 'client',
  '$2a$10$8K1a/aQkQkQkQkQkQkQkQeQkQkQkQkQkQkQkQkQkQkQkQkQkQ',
  'Hospital Admin', 'admin@vgrandhospital.com', true
WHERE NOT EXISTS (SELECT 1 FROM portal_accounts WHERE username = 'client');
