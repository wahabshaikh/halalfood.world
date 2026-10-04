-- Indexes for the public directory.
-- Counts, the city list, and id-ordered sitemap slices read every listed place.
-- A partial index lets those queries walk listed rows instead of the whole table.
-- The lat/lng index matches listing_status, which the older lat/lng index does not mention.
-- Keep comments free of quote characters and of semicolons.

CREATE INDEX IF NOT EXISTS places_public_id_idx
  ON places (id)
  WHERE halal_confirmed = 1 AND listing_status = 'listed';

CREATE INDEX IF NOT EXISTS places_public_city_idx
  ON places (city_slug, id)
  WHERE halal_confirmed = 1 AND listing_status = 'listed';

CREATE INDEX IF NOT EXISTS places_public_lat_lng_idx
  ON places (lat, lng)
  WHERE halal_confirmed = 1 AND listing_status = 'listed'
    AND lat IS NOT NULL AND lng IS NOT NULL;
