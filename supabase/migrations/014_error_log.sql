-- Error log table — stores production errors captured by the error tracking layer.
-- Used as a lightweight, dependency-free error tracking solution alongside Lovable telemetry.
create table if not exists public.error_log (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  stack text,
  source text, -- e.g. "client_error_boundary", "server_fn", "notification"
  route text,
  user_id uuid,
  severity text not null default 'error',
  context jsonb,
  created_at timestamptz not null default now()
);

-- Index for querying recent errors
create index if not exists error_log_created_at_idx on public.error_log (created_at desc);
create index if not exists error_log_severity_idx on public.error_log (severity);

-- Enable RLS (deny-all — only service_role can access)
alter table public.error_log enable row level security;
revoke all on public.error_log from anon, authenticated;
