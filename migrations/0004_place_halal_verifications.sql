-- Community halal verification evidence. D1/SQLite dialect.
-- Apply after 0003_saved_places.sql.

CREATE TABLE IF NOT EXISTS "place_halal_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "submitted_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending', 'approved', 'rejected')),
  "note" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "place_halal_verifications_place_status_created_idx"
  ON "place_halal_verifications" ("place_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "place_halal_verifications_submitter_idx"
  ON "place_halal_verifications" ("submitted_by_user_id", "created_at");

CREATE TABLE IF NOT EXISTS "place_halal_verification_evidence" (
  "id" text PRIMARY KEY NOT NULL,
  "verification_id" text NOT NULL
    REFERENCES "place_halal_verifications"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('link', 'upload')),
  "url" text,
  "r2_key" text,
  "content_type" text,
  "file_name" text,
  "size_bytes" integer,
  "created_at" integer NOT NULL,
  CHECK (
    "content_type" IS NULL
    OR "content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  CHECK (
    "size_bytes" IS NULL OR "size_bytes" BETWEEN 1 AND 8388608
  ),
  CHECK (
    ("kind" = 'link'
      AND "url" IS NOT NULL
      AND "r2_key" IS NULL
      AND "content_type" IS NULL
      AND "file_name" IS NULL
      AND "size_bytes" IS NULL)
    OR
    ("kind" = 'upload'
      AND "url" IS NULL
      AND "r2_key" IS NOT NULL
      AND "content_type" IS NOT NULL
      AND "file_name" IS NOT NULL
      AND "size_bytes" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "place_halal_verification_evidence_verification_idx"
  ON "place_halal_verification_evidence" ("verification_id", "created_at");

CREATE INDEX IF NOT EXISTS "place_halal_verification_evidence_r2_key_idx"
  ON "place_halal_verification_evidence" ("r2_key");
