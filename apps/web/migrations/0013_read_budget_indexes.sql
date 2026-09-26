-- Indexes that keep hot read paths off full-table scans. D1 bills every row a
-- query scans, so an unindexed filter on places costs the whole table
-- (~12k rows) per request, and a crawler walking the sitemap multiplies that.
-- Keep comments here free of quote characters: the remote migration runner
-- splits statements with a quote-aware scanner that does not skip comments.

-- Viewport and near-me lookups filter listed places by a lat/lng box. The
-- partial predicate matches the one every listing query already carries, so
-- SQLite can use this index to read only the latitude band being asked for.
CREATE INDEX IF NOT EXISTS "places_listed_lat_lng_idx"
  ON "places" ("lat", "lng")
  WHERE "halal_confirmed" = 1 AND "lat" IS NOT NULL AND "lng" IS NOT NULL;

-- The Better Auth database rate limiter prunes expired rows by last_request
-- after every window reset.
CREATE INDEX IF NOT EXISTS "rate_limit_last_request_idx"
  ON "rate_limit" ("last_request");
