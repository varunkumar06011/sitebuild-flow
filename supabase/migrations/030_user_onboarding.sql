-- 030_user_onboarding.sql
-- Tracks which sections a user has completed the onboarding tour for.
-- This makes tour state follow the user across devices/logins rather than
-- being stuck to one browser's localStorage.

CREATE TABLE IF NOT EXISTS user_onboarding (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_key   text NOT NULL,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_user_id ON user_onboarding(user_id);

-- RLS: deny all direct access (app uses service_role key, defense-in-depth)
ALTER TABLE user_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_onboarding FROM anon, authenticated;
