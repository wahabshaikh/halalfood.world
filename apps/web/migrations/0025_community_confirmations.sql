-- One confirmation per person per public halal check or check-in.
-- The author of the target is never stored. Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS community_confirmations (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('verification', 'check-in')),
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS community_confirmations_user_target_idx
  ON community_confirmations (target_type, target_id, user_id);

CREATE INDEX IF NOT EXISTS community_confirmations_target_idx
  ON community_confirmations (target_type, target_id);
