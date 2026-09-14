-- Community halal place photos. Apply after 0006_place_reviews.sql.
-- Photos reuse the existing HALAL_EVIDENCE_R2 binding under the photos/ key
-- prefix. Every statement is additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "place_photos" (
  "id" uuid PRIMARY KEY NOT NULL,
  "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "r2_key" text NOT NULL UNIQUE,
  "content_type" text NOT NULL CHECK (
    "content_type" IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  "byte_size" integer NOT NULL CHECK (
    "byte_size" BETWEEN 1 AND 8388608
  ),
  "original_file_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "place_photos_place_id_created_at_idx"
  ON "place_photos" ("place_id", "created_at" DESC);
