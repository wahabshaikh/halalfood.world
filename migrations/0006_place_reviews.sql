-- Community halal place reviews. Apply after 0005_place_ratings.sql.
-- One user can keep one editable review for each place; the composite primary
-- key makes the upsert/delete ownership rule durable at the database layer.
-- Every statement is additive and safe to re-run.

CREATE TABLE IF NOT EXISTS "place_reviews" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "title" text CHECK ("title" IS NULL OR length("title") <= 120),
  "body" text NOT NULL CHECK (
    length(btrim("body")) > 0 AND length("body") <= 5000
  ),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "place_id")
);

CREATE INDEX IF NOT EXISTS "place_reviews_place_id_created_at_idx"
  ON "place_reviews" ("place_id", "created_at" DESC);
