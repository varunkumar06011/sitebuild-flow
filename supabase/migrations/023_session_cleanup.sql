-- Session cleanup: deletes expired/revoked session rows.
--
-- This migration creates a SQL function that can be called manually or scheduled
-- via pg_cron (if available on your Supabase plan).
--
-- To schedule with pg_cron (Supabase Pro+ or self-hosted with pg_cron extension):
--   SELECT cron.schedule('session-cleanup', '0 * * * *', 'SELECT cleanup_expired_sessions()');
--   -- runs hourly; adjust cron expression as needed
--
-- To schedule externally (e.g. Vercel Cron, GitHub Actions, or any scheduler):
--   Run `SELECT cleanup_expired_sessions();` via the Supabase SQL editor or
--   a scheduled server function on whatever cadence you prefer.

-- Deletes sessions that are expired or revoked.
-- Returns the number of rows deleted.
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM sessions
  WHERE expires_at < now() OR revoked = true;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Grant execute to service_role only (server functions use service_role key).
REVOKE EXECUTE ON FUNCTION cleanup_expired_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_sessions() TO service_role;
