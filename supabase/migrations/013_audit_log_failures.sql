-- Audit log failures table — stores audit records that failed to insert after retries.
-- This ensures audit records are not silently lost when the main audit_log table is unavailable.
create table if not exists public.audit_log_failures (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  error text,
  created_at timestamptz not null default now()
);

-- Enable RLS (deny-all — only service_role can access)
alter table public.audit_log_failures enable row level security;
revoke all on public.audit_log_failures from anon, authenticated;
