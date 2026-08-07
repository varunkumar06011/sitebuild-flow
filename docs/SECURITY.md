# Security Architecture & Operations

## Authentication Model

The ERP uses a **two-layer authentication pattern**:

1. **Client-side guards** (`src/lib/auth-guards.ts`) — redirect unauthenticated users to `/login` for UX. These are NOT security boundaries; they run in the browser and can be bypassed.

2. **Server-side enforcement** (`src/lib/api/session.ts`) — every server function calls `requireSessionUser()` which validates the JWT session cookie against the `sessions` table. This is the real security boundary.

**Never rely on client-side guards alone.** Every server function must call `requireSessionUser()`.

## Session Management

- JWT signed with `APP_JWT_SECRET` environment variable
- Session tokens are bcrypt-hashed before storage (never stored in plaintext)
- Sessions have an expiry timestamp and can be revoked
- Cookie: `meditrust_session`, `HttpOnly`, `SameSite=Lax`

## Row Level Security (RLS)

All tables have RLS enabled with a **deny-all** default:

- `anon` and `authenticated` roles have all privileges revoked
- The app uses the `service_role` key which bypasses RLS
- All authorization is enforced in application server functions
- Defense-in-depth policies added in migration `015_rls_defense_in_depth.sql` protect against accidental key exposure

## Service Role Key Management

The `SUPABASE_SERVICE_ROLE_KEY` is the single most sensitive secret in the system. It bypasses RLS and has full access to all tables.

### Storage

- Store in environment variables only — never in code, never in git
- Production: use your hosting provider's secret management (Vercel env vars, AWS Secrets Manager, etc.)
- Never log the key or include it in error messages

### Rotation Procedure

Rotate the service role key if any of the following occur:
- Suspected or confirmed key exposure
- Team member departure with key access
- Routine security rotation (recommended every 90 days)

**Steps to rotate:**

1. Generate a new service role key in the Supabase dashboard:
   - Project Settings → API → Service Role Key → Regenerate
2. Update the environment variable on all environments:
   - `SUPABASE_SERVICE_ROLE_KEY=<new_key>`
   - Update in Vercel (or your hosting provider)
   - Update in any CI/CD pipelines
   - Update in local `.env` files for developers
3. Redeploy all environments to pick up the new key
4. Verify the application works:
   - Login works
   - Requisition creation works
   - Approval workflow works
5. Revoke the old key in the Supabase dashboard (if not auto-revoked)

### Access Control

- Only senior engineers/DevOps should have access to the service role key
- Never share the key in chat, email, or documentation
- Use a secrets manager for team access (1Password, Vault, etc.)
- The key should never appear in client-side code or browser network requests

## JWT Secret Management

The `APP_JWT_SECRET` is used to sign session JWTs. If compromised, an attacker can forge sessions.

### Rotation Procedure

1. Generate a new secret: `openssl rand -hex 32`
2. Update `APP_JWT_SECRET` in all environments
3. **All existing sessions will be invalidated** — users will need to log in again
4. Redeploy all environments
5. Optionally, clean up expired sessions in the database:
   ```sql
   DELETE FROM sessions WHERE expires_at < now();
   ```

## Audit Logging

All critical operations are logged to the `audit_log` table:

- `create_requisition`
- `update_requisition`
- `update_stage` (includes approve, reject, cancel, advance)

The audit log is **immutable** — a database trigger prevents updates and deletes.

If audit log inserts fail, they are retried 3 times with exponential backoff, then logged to the `audit_log_failures` table.

## Error Tracking

Production errors are logged to the `error_log` table via the `logError` server function. The root error boundary also reports errors to this table.

Monitor the `error_log` table regularly or set up alerts for new entries with `severity = 'error'`.

## Notification Reliability

Notifications (approval requests, approval results) are sent via the `notifications` table. Failures are caught and logged to `console.error` — they do not block the main operation.

If notifications are critical, consider:
- Setting up alerts on notification failures
- Adding a retry mechanism for failed notifications
- Using a background job queue for delivery
