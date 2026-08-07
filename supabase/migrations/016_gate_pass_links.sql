-- ============================================================================
-- Meditrust ERP — Gate Pass Traceability & Document Linking
-- ============================================================================
-- Links a gate pass to its procurement pipeline (requisition = PR/Quotation/PO/
-- Material Received/Invoice/Payment) and to its material traceability batch
-- (Supplier -> Batch -> Manufacturer -> Invoice -> Challan -> MTC -> Lab Report
--  -> Photos).
-- ============================================================================

-- Link a gate pass to a requisition (procurement document chain).
ALTER TABLE gate_passes
  ADD COLUMN IF NOT EXISTS requisition_id uuid REFERENCES requisitions(id);

-- Link a gate pass to a material batch (traceability chain).
ALTER TABLE gate_passes
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES batches(id);

-- Speeds up filtering gate passes by linked requisition.
CREATE INDEX IF NOT EXISTS idx_gate_passes_requisition_id ON gate_passes(requisition_id);
-- Speeds up filtering gate passes by linked batch.
CREATE INDEX IF NOT EXISTS idx_gate_passes_batch_id ON gate_passes(batch_id);
