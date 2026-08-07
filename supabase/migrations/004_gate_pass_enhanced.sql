-- ============================================================================
-- Meditrust ERP — Gate Pass Enhanced Schema
-- ============================================================================
-- Adds extended fields to gate_passes for the full Gate Pass module:
--   person name, vehicle type, driver details, material movement flag,
--   material list, remarks, photo proof, editable date/time.
-- Replaces monthly sequence with a GLOBAL sequential number (never resets).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Add new columns to gate_passes
-- ----------------------------------------------------------------------------
ALTER TABLE gate_passes
  ADD COLUMN IF NOT EXISTS person_name       text,
  ADD COLUMN IF NOT EXISTS vehicle_type      text,
  ADD COLUMN IF NOT EXISTS driver_name       text,
  ADD COLUMN IF NOT EXISTS driver_mobile     text,
  ADD COLUMN IF NOT EXISTS material_movement boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS material_list     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS remarks           text,
  ADD COLUMN IF NOT EXISTS photo_proof_path  text,
  ADD COLUMN IF NOT EXISTS gp_date           date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS gp_time           text NOT NULL DEFAULT to_char(now(), 'HH24:MI');

-- ----------------------------------------------------------------------------
-- Global gate pass sequence (single row — never resets monthly)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gate_pass_global_seq (
  id        int PRIMARY KEY DEFAULT 1,
  last_seq  bigint NOT NULL DEFAULT 0,
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO gate_pass_global_seq (id, last_seq) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

-- Migrate existing monthly counts into the global counter
UPDATE gate_pass_global_seq
SET last_seq = GREATEST(last_seq, COALESCE(
  (SELECT sum(last_seq) FROM gate_pass_sequences), 0
));

-- ----------------------------------------------------------------------------
-- Replace next_gp_number() with global sequential format: GP/0001
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_gp_number()
RETURNS text AS $$
DECLARE
  next_seq bigint;
  gp_num   text;
BEGIN
  UPDATE gate_pass_global_seq
    SET last_seq = last_seq + 1
    WHERE id = 1
    RETURNING last_seq INTO next_seq;

  gp_num := 'GP/' || LPAD(next_seq::text, 4, '0');
  RETURN gp_num;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS on the new table
ALTER TABLE gate_pass_global_seq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gate_pass_global_seq FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Index for searching gate passes by person name or gp_number
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_gate_passes_gp_number ON gate_passes(gp_number);
CREATE INDEX IF NOT EXISTS idx_gate_passes_person_name ON gate_passes(person_name);
CREATE INDEX IF NOT EXISTS idx_gate_passes_status ON gate_passes(status);
