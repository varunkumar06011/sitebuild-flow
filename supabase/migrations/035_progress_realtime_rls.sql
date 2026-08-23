-- ============================================================================
-- Meditrust ERP — Phase 5: Supabase Realtime for live cross-device updates
-- ============================================================================
-- Adds narrow SELECT-only RLS policies on progress_cells, progress_cell_history,
-- and progress_cell_photos for the authenticated role, scoped to rows the
-- requesting user is allowed to see (admins see all; supervisors see only
-- cells in their assigned blocks/floors).
--
-- Writes remain server-only — no INSERT/UPDATE/DELETE policies are added.
-- The service-role key used by the Express server bypasses RLS entirely.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper function: can a user see a given cell?
-- SECURITY DEFINER so it can read progress_supervisor_assignments and
-- progress_cell_groups (which are deny-all for authenticated) without
-- needing separate grants on those tables.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_user_see_cell(
  target_cell_id   uuid,
  requesting_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Admin roles see everything
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = requesting_user_id
        AND u.role IN ('Administrator', 'A1', 'A1+')
    )
    OR (
      -- Supervisor sees cells in their assigned blocks/floors
      EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = requesting_user_id AND u.role = 'Supervisor'
      )
      AND EXISTS (
        SELECT 1
        FROM progress_supervisor_assignments psa
        JOIN progress_cell_groups pcg
          ON pcg.id = (SELECT cell_group_id FROM progress_cells WHERE id = target_cell_id)
        WHERE psa.supervisor_id = requesting_user_id
          AND psa.block_id = pcg.block_id
          AND (psa.floor_id IS NULL OR psa.floor_id = pcg.floor_id)
      )
    )
$$;

-- Allow authenticated users to execute the helper
GRANT EXECUTE ON FUNCTION public.can_user_see_cell(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- GRANT SELECT only (no INSERT/UPDATE/DELETE) on the three realtime tables
-- ----------------------------------------------------------------------------
GRANT SELECT ON progress_cells          TO authenticated;
GRANT SELECT ON progress_cell_history   TO authenticated;
GRANT SELECT ON progress_cell_photos    TO authenticated;

-- ----------------------------------------------------------------------------
-- RLS policies: SELECT only, scoped by can_user_see_cell
-- ----------------------------------------------------------------------------

CREATE POLICY progress_cells_read_assigned
  ON progress_cells
  FOR SELECT TO authenticated
  USING (public.can_user_see_cell(id, auth.uid()));

CREATE POLICY progress_cell_history_read_assigned
  ON progress_cell_history
  FOR SELECT TO authenticated
  USING (public.can_user_see_cell(cell_id, auth.uid()));

CREATE POLICY progress_cell_photos_read_assigned
  ON progress_cell_photos
  FOR SELECT TO authenticated
  USING (public.can_user_see_cell(cell_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- Add the three tables to the supabase_realtime publication
-- ----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE progress_cells;
ALTER PUBLICATION supabase_realtime ADD TABLE progress_cell_history;
ALTER PUBLICATION supabase_realtime ADD TABLE progress_cell_photos;
