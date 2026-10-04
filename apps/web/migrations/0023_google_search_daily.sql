-- Daily budget for paid Google Places Text Search.
-- One row per UTC day. call_count increases only when a request calls Google.
-- A cache hit does not write a row.

CREATE TABLE IF NOT EXISTS google_search_daily (
  day TEXT PRIMARY KEY NOT NULL,
  call_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
