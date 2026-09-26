-- Base halal places table. D1/SQLite dialect.
-- Apply after 0001_better_auth_email_otp.sql.
--
-- `serves_cuisine` is a JSON array stored as text (SQLite has no array type).
-- `rating_value` is stored as text to preserve scraped formatting like
-- "4.30"; ratings are 0-5 so `CAST(rating_value AS REAL)` orders correctly.
-- Timestamps are Unix epoch milliseconds; `halal_confirmed` is 0/1.

CREATE TABLE IF NOT EXISTS "places" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "city_slug" text NOT NULL,
  "city_url" text NOT NULL,
  "list_position" integer,
  "street_address" text NOT NULL,
  "address_locality" text,
  "address_region" text,
  "postal_code" text,
  "address_country" text,
  "telephone" text,
  "website" text,
  "maps_url" text,
  "google_place_id" text,
  "serves_cuisine" text NOT NULL,
  "rating_value" text,
  "review_count" integer,
  "source" text NOT NULL,
  "source_url" text NOT NULL,
  "scraped_at" integer NOT NULL,
  "created_at" integer NOT NULL,
  "lat" real,
  "lng" real,
  -- Present only for community-submitted rows; existing imported rows
  -- remain visible as halal listings without an owning user.
  "submitted_by_user_id" text,
  "halal_confirmed" integer NOT NULL DEFAULT 1,
  "google_details_cached_at" integer,
  "google_details_snapshot" text
);

CREATE INDEX IF NOT EXISTS "places_submitted_by_user_id_idx"
  ON "places" ("submitted_by_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "places_city_name_address_unique_idx"
  ON "places" ("city_slug", "name", "street_address");

CREATE UNIQUE INDEX IF NOT EXISTS "places_google_place_id_unique_idx"
  ON "places" ("google_place_id")
  WHERE "google_place_id" IS NOT NULL;
