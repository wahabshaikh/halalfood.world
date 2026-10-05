-- Halal status from several signals (docs/product/halal-model.md).
--
-- Community checks are one source of evidence. The others live here:
--   certificate  a photo of the halal certificate, reviewed by a moderator
--   menu         a photo of the menu, reviewed by a moderator
--   listing      a map listing's halal tag (OpenStreetMap via Overpass, Geoapify)
--
-- Each row answers some of the four facts. Documents count once approved;
-- listings are imported as approved and never settle a fact on their own.

CREATE TABLE "place_signals" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "source" text NOT NULL CHECK ("source" IN ('certificate', 'menu', 'listing')),
  -- Listings only: where the tag came from and its id there.
  "provider" text CHECK ("provider" IN ('osm', 'geoapify')),
  "external_id" text,
  -- What the evidence says. Null means it doesn't say.
  "owned" text CHECK ("owned" IN ('yes', 'no')),
  "certified" text CHECK ("certified" IN ('yes', 'no')),
  "pork" text CHECK ("pork" IN ('yes', 'no')),
  "alcohol" text CHECK ("alcohol" IN ('yes', 'no')),
  -- Listings only: the raw halal claim, 'only' | 'yes' | 'no'.
  "listing_claim" text CHECK ("listing_claim" IN ('only', 'yes', 'no')),
  -- Documents only: the uploaded photo and who sent it.
  "photo_id" text REFERENCES "place_photos"("id") ON DELETE SET NULL,
  "submitted_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  -- Certificates only: the certifying body, as written on the certificate.
  "certifier" text CHECK ("certifier" IS NULL OR length("certifier") <= 120),
  "expires_at" integer,
  "review_status" text NOT NULL DEFAULT 'pending' CHECK ("review_status" IN ('pending', 'approved', 'rejected')),
  "reviewed_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "reviewed_at" integer,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  CHECK (("source" = 'listing') = ("provider" IS NOT NULL AND "external_id" IS NOT NULL))
);
CREATE INDEX "place_signals_place_idx" ON "place_signals" ("place_id", "review_status");
CREATE INDEX "place_signals_review_idx" ON "place_signals" ("review_status", "created_at");
CREATE UNIQUE INDEX "place_signals_listing_idx" ON "place_signals" ("place_id", "provider", "external_id")
  WHERE "source" = 'listing';

-- Which sources back each fact's current value, as a comma list
-- ("community,certificate"), and whether settling sources disagree.
ALTER TABLE "place_status" ADD COLUMN "owned_sources" text NOT NULL DEFAULT '';
ALTER TABLE "place_status" ADD COLUMN "certified_sources" text NOT NULL DEFAULT '';
ALTER TABLE "place_status" ADD COLUMN "pork_sources" text NOT NULL DEFAULT '';
ALTER TABLE "place_status" ADD COLUMN "alcohol_sources" text NOT NULL DEFAULT '';
ALTER TABLE "place_status" ADD COLUMN "disputed_facts" text NOT NULL DEFAULT '';
-- The newest approved map listing's halal claim, shown as context.
ALTER TABLE "place_status" ADD COLUMN "listing_claim" text CHECK ("listing_claim" IN ('only', 'yes', 'no'));

-- Existing rows were all settled by community checks alone.
UPDATE "place_status" SET "owned_sources" = 'community' WHERE "owned_value" IS NOT NULL;
UPDATE "place_status" SET "certified_sources" = 'community' WHERE "certified_value" IS NOT NULL;
UPDATE "place_status" SET "pork_sources" = 'community' WHERE "pork_value" IS NOT NULL;
UPDATE "place_status" SET "alcohol_sources" = 'community' WHERE "alcohol_value" IS NOT NULL;
