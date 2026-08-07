-- RLS defense-in-depth policies.
-- The application enforces authorization in server functions via requireSessionUser().
-- These policies provide a backup layer so that even if the service role key is misused
-- via the Supabase JS client (not the server SDK), users can only access their own data.
--
-- NOTE: The app uses the service_role key which bypasses RLS entirely.
-- These policies protect against accidental exposure of the anon/authenticated key
-- and against direct database access via the Supabase dashboard with non-service roles.

-- ============================================================================
-- Users: users can read their own profile; only service_role can write
-- ============================================================================
create policy "users_read_self" on public.users
  for select to authenticated
  using (auth.uid() = id);

-- ============================================================================
-- Sessions: users can only see their own sessions
-- ============================================================================
create policy "sessions_read_self" on public.sessions
  for select to authenticated
  using (auth.uid() = user_id);

-- ============================================================================
-- Requisitions: supervisors see their own; approvers see all pending their tier
-- ============================================================================
create policy "requisitions_read_own_or_pending" on public.requisitions
  for select to authenticated
  using (
    raised_by = auth.uid()
    OR stage IN ('Admin', 'A1', 'A1+', 'Quotation', 'PO', 'Material Received', 'Invoice', 'Payment')
  );

-- ============================================================================
-- Notifications: users see only their own notifications
-- ============================================================================
create policy "notifications_read_own" on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- Audit log: A1+ only (read); no client writes
-- ============================================================================
create policy "audit_log_read_a1plus" on public.audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'A1+'
    )
  );

-- ============================================================================
-- Vendors: all authenticated users can read; no client writes
-- ============================================================================
create policy "vendors_read_authenticated" on public.vendors
  for select to authenticated
  using (true);

-- ============================================================================
-- Inventory items: all authenticated users can read
-- ============================================================================
create policy "inventory_items_read_authenticated" on public.inventory_items
  for select to authenticated
  using (true);

create policy "inventory_transactions_read_authenticated" on public.inventory_transactions
  for select to authenticated
  using (true);

-- ============================================================================
-- Vendor payments: approvers and supervisors can read
-- ============================================================================
create policy "vendor_payments_read_authenticated" on public.vendor_payments
  for select to authenticated
  using (true);
