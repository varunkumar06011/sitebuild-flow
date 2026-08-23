-- Add default_cell_count to progress_floors so admins can configure the number of
-- flat/unit cells for a floor once, and new work items inherit that count automatically.
-- Existing cell groups and their cells are not affected; this only controls future work items.

alter table public.progress_floors
  add column if not exists default_cell_count integer default 1;

comment on column public.progress_floors.default_cell_count is
  'Default number of unit cells created for each work item added to this floor.';
