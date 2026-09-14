-- Community halal place reactions. Apply after 0004_place_halal_verifications.sql.
-- Aggregates are calculated at read time from this table; no counters need
-- synchronization when a user changes their reaction.
-- Every statement is additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "place_ratings" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "rating" text NOT NULL CHECK (
    "rating" IN ('mashallah', 'alhamdulillah', 'astaghfirullah')
  ),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "place_id")
);

CREATE INDEX IF NOT EXISTS "place_ratings_place_id_rating_idx"
  ON "place_ratings" ("place_id", "rating");
