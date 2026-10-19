-- Additive queue for reviewing suspicious vouches without blocking community contributions.
-- Contribution ids are a JSON snapshot; account deletion removes its flags.
CREATE TABLE contribution_flags (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('velocity', 'distance', 'self_vouch', 'ip_cluster')),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  place_id TEXT REFERENCES places(id) ON DELETE SET NULL ON UPDATE CASCADE,
  contribution_ids TEXT NOT NULL CHECK (json_valid(contribution_ids) AND json_type(contribution_ids) = 'array'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'upheld')),
  created_at INTEGER NOT NULL,
  reviewed_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  reason TEXT
);
CREATE INDEX contribution_flags_queue_idx ON contribution_flags(status, created_at);
CREATE INDEX contribution_flags_user_idx ON contribution_flags(user_id);
