-- Social lists, phase 3: a cover and caption, collaborators, saves and an
-- optional edit link. D1/SQLite dialect. Keep comments here free of quote
-- characters: the remote migration runner splits statements with a
-- quote-aware scanner that does not skip comments, and it refuses DROP TABLE,
-- so nothing is rebuilt.

ALTER TABLE "place_lists" ADD COLUMN "caption" text CHECK ("caption" IS NULL OR length("caption") <= 140);

ALTER TABLE "place_lists"
  ADD COLUMN "cover_place_id" text REFERENCES "places"("id") ON DELETE SET NULL;

-- A random token, present only while the owner has switched the edit link on.
ALTER TABLE "place_lists" ADD COLUMN "edit_token" text;

-- Who put a place on a shared list, so a collaborator can take back their own.
ALTER TABLE "place_list_items"
  ADD COLUMN "added_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL;

-- An invited diner sees the list and can accept or decline. Only accepted
-- collaborators may edit. The owner is never a row here.
CREATE TABLE IF NOT EXISTS "list_collaborators" (
  "list_id" text NOT NULL REFERENCES "place_lists"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'invited' CHECK ("status" IN ('invited', 'accepted')),
  "invited_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  PRIMARY KEY ("list_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "list_collaborators_user_idx"
  ON "list_collaborators" ("user_id", "status");

-- Saving a list is taste, like a like. It never touches a halal status.
CREATE TABLE IF NOT EXISTS "list_saves" (
  "list_id" text NOT NULL REFERENCES "place_lists"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("list_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "list_saves_user_idx"
  ON "list_saves" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "place_lists_visibility_idx"
  ON "place_lists" ("visibility", "updated_at" DESC);

-- The map asks which friends shared a visit at a place, which the actor index
-- cannot answer on its own.
CREATE INDEX IF NOT EXISTS "feed_events_place_idx"
  ON "feed_events" ("place_id", "actor_id");
