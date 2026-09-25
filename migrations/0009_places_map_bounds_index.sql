-- Narrow map bounding-box queries to confirmed listings with coordinates.
-- Partial indexing keeps unconfirmed and ungeocoded rows out of the index.
CREATE INDEX IF NOT EXISTS "places_map_bounds_idx"
  ON "places" ("lat", "lng")
  WHERE "halal_confirmed" = 1
    AND "lat" IS NOT NULL
    AND "lng" IS NOT NULL;

PRAGMA optimize;
