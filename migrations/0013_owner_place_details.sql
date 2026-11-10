-- Phone, website and a short description the restaurant types.
--
-- Not a halal fact. Nothing here is written onto places.telephone or places.website,
-- and lib/core/halal.ts does not read this table. The place page shows the row only
-- after the claim is public (paid and moderator-approved). Only the account that
-- claimed with role 'owner' can write it, and only while the paid window is open.
--
-- Safe to run again: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "owner_place_details" (
  "place_id" text PRIMARY KEY NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "claim_id" text NOT NULL REFERENCES "owner_claims"("id") ON DELETE CASCADE,
  "phone" text CHECK ("phone" IS NULL OR length("phone") <= 32),
  "website" text CHECK ("website" IS NULL OR length("website") <= 300),
  "description" text CHECK ("description" IS NULL OR length("description") <= 400),
  "updated_at" integer NOT NULL
);
