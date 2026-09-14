-- User-submitted place support. Apply after 0001_better_auth_email_otp.sql.
-- Every statement is additive and safe to re-run.

ALTER TABLE "places"
  ADD COLUMN IF NOT EXISTS "submitted_by_user_id" text;

-- Existing imported rows remain visible as halal listings. New submissions
-- can only be written by the API after an explicit confirmation.
ALTER TABLE "places"
  ADD COLUMN IF NOT EXISTS "halal_confirmed" boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "places_submitted_by_user_id_idx"
  ON "places" ("submitted_by_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "places_city_name_address_unique_idx"
  ON "places" ("city_slug", "name", "street_address");

CREATE UNIQUE INDEX IF NOT EXISTS "places_google_place_id_unique_idx"
  ON "places" ("google_place_id")
  WHERE "google_place_id" IS NOT NULL;
