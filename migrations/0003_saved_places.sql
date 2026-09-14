-- Saved halal places. Apply after 0002_user_submitted_places.sql.
-- Every statement is additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "saved_places" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "place_id")
);

CREATE INDEX IF NOT EXISTS "saved_places_user_id_created_at_idx"
  ON "saved_places" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "saved_places_place_id_idx"
  ON "saved_places" ("place_id");
