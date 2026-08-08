-- 019_system_robustness.sql
-- Approval delegation, SLA escalation, document versioning, and escalation log tables.

-- ============================================================================
-- Approval Delegation
-- Allows a user to delegate approval authority to another user for a date range.
-- ============================================================================
CREATE TABLE IF NOT EXISTS approval_delegations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  delegator_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegate_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date      date NOT NULL DEFAULT CURRENT_DATE,
  end_date        date NOT NULL,
  reason          text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_delegation CHECK (delegator_id <> delegate_id),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_delegations_delegator ON approval_delegations(delegator_id);
CREATE INDEX IF NOT EXISTS idx_delegations_delegate ON approval_delegations(delegate_id);
CREATE INDEX IF NOT EXISTS idx_delegations_active ON approval_delegations(active) WHERE active = true;

-- ============================================================================
-- Approval Escalation Log
-- Records when an approval is escalated to the next tier after exceeding SLA.
-- ============================================================================
CREATE TABLE IF NOT EXISTS escalation_log (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  requisition_id  uuid NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  from_stage      text NOT NULL,
  to_stage        text NOT NULL,
  reason          text NOT NULL,
  sla_hours       int NOT NULL,
  escalated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_escalation_requisition ON escalation_log(requisition_id);
CREATE INDEX IF NOT EXISTS idx_escalation_unresolved ON escalation_log(resolved_at) WHERE resolved_at IS NULL;

-- ============================================================================
-- Document Versions
-- Tracks version history for documents (quotations, invoices, MTC, lab reports, etc.)
-- Each document version is linked to a parent entity (requisition, batch, vendor, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS document_versions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type     text NOT NULL,  -- 'requisition', 'batch', 'vendor', 'gate_pass', 'inspection'
  entity_id       uuid NOT NULL,  -- ID of the parent entity
  field_name      text NOT NULL,  -- e.g. 'quotations', 'documents', 'mtc', 'lab_report'
  version         int NOT NULL DEFAULT 1,
  file_path       text NOT NULL,
  file_name       text,
  uploaded_by     uuid REFERENCES users(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  superseded      boolean NOT NULL DEFAULT false,
  notes           text,
  UNIQUE (entity_type, entity_id, field_name, version)
);

CREATE INDEX IF NOT EXISTS idx_doc_versions_entity ON document_versions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_doc_versions_active ON document_versions(entity_type, entity_id, field_name) WHERE superseded = false;

-- ============================================================================
-- RLS Policies
-- ============================================================================
ALTER TABLE approval_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

-- Delegations: users can see delegations they made or received
CREATE POLICY "delegations_read_own" ON approval_delegations
  FOR SELECT TO authenticated
  USING (delegator_id = auth.uid() OR delegate_id = auth.uid());

-- Escalation log: all authenticated users can see (transparency)
CREATE POLICY "escalation_log_read" ON escalation_log
  FOR SELECT TO authenticated
  USING (true);

-- Document versions: all authenticated users can see
CREATE POLICY "doc_versions_read" ON document_versions
  FOR SELECT TO authenticated
  USING (true);

-- ============================================================================
-- Seed: example delegation
-- ============================================================================
INSERT INTO approval_delegations (delegator_id, delegate_id, start_date, end_date, reason, active)
SELECT
  (SELECT id FROM users WHERE username = 'a1'),
  (SELECT id FROM users WHERE username = 'admin'),
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '7 days',
  'On leave for one week — delegating approvals to Administrator',
  true
WHERE EXISTS (SELECT 1 FROM users WHERE username = 'a1')
  AND EXISTS (SELECT 1 FROM users WHERE username = 'admin')
ON CONFLICT DO NOTHING;
