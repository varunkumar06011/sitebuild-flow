-- Link progress_blocks to progress_work_views so the Venture → Block → Floor flow is persistent.
-- Existing blocks are backfilled to the default "General" work view (created in migration 032) when possible.

alter table public.progress_blocks
  add column if not exists work_view_id uuid references public.progress_work_views(id) on delete set null;

do $$
declare
  general_view_id uuid;
begin
  select id into general_view_id from public.progress_work_views where name = 'General' order by sort_order limit 1;

  if general_view_id is not null then
    update public.progress_blocks
    set work_view_id = general_view_id
    where work_view_id is null;
  end if;
end $$;

create index if not exists idx_progress_blocks_work_view_id on public.progress_blocks(work_view_id);

comment on column public.progress_blocks.work_view_id is
  'Venture / work view this block belongs to (part of the Venture → Block → Floor hierarchy).';
