-- Cached Google Essentials details for canonical restaurant pages.
-- Apply after 0007_place_photos.sql. Every statement is additive and safe to
-- re-run. The snapshot contains only normalized, non-secret Google fields.

ALTER TABLE "places"
  ADD COLUMN IF NOT EXISTS "google_details_cached_at" timestamptz;

ALTER TABLE "places"
  ADD COLUMN IF NOT EXISTS "google_details_snapshot" text;
