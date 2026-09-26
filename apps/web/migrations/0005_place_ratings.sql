-- Community halal place reactions. D1/SQLite dialect.
-- Apply after 0004_place_halal_verifications.sql.
-- Aggregates are calculated at read time from this table; no counters need
-- synchronization when a user changes their reaction.

CREATE TABLE IF NOT EXISTS "place_ratings" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "rating" text NOT NULL CHECK (
    "rating" IN ('mashallah', 'alhamdulillah', 'astaghfirullah')
  ),
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  PRIMARY KEY ("user_id", "place_id")
);

CREATE INDEX IF NOT EXISTS "place_ratings_place_id_rating_idx"
  ON "place_ratings" ("place_id", "rating");
