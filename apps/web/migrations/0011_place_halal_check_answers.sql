-- Structured answers from a step-by-step halal check. D1/SQLite dialect.
-- One optional row per verification; every answer is a fixed choice so the
-- place page can summarise them without free text.

CREATE TABLE IF NOT EXISTS "place_halal_check_answers" (
  "verification_id" text PRIMARY KEY NOT NULL
    REFERENCES "place_halal_verifications"("id") ON DELETE CASCADE,
  "certificate" text
    CHECK ("certificate" IS NULL OR "certificate" IN ('seen', 'not-seen', 'unsure')),
  "alcohol" text
    CHECK ("alcohol" IS NULL OR "alcohol" IN ('none', 'served', 'unsure')),
  "meat" text
    CHECK ("meat" IS NULL OR "meat" IN ('hand', 'machine', 'unsure')),
  "created_at" integer NOT NULL
);
