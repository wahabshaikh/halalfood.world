-- A place link submitted while Google search is down.
-- It stays pending until a person reviews it. It is not a public listing
-- and it is not a halal certification.
-- Keep comments free of quote characters. The remote runner splits on them.

CREATE TABLE IF NOT EXISTS place_link_submissions (
  id TEXT PRIMARY KEY,
  submitted_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city_slug TEXT NOT NULL,
  street_address TEXT NOT NULL,
  source_url TEXT NOT NULL,
  google_place_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  status_reason TEXT,
  matched_place_id TEXT REFERENCES places(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (status IN ('pending','accepted','rejected','needs-evidence')),
  CHECK (length(trim(name)) BETWEEN 1 AND 120),
  CHECK (length(trim(street_address)) BETWEEN 1 AND 200),
  CHECK (length(source_url) BETWEEN 8 AND 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS place_link_submissions_user_url_idx
  ON place_link_submissions (submitted_by_user_id, source_url);
