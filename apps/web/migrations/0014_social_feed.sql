-- Social feed, phase 2: verdicts, friends feed, reactions and comments.
-- D1/SQLite dialect. Keep comments here free of quote characters: the remote
-- migration runner splits statements with a quote-aware scanner that does not
-- skip comments, and it refuses DROP TABLE, so nothing is rebuilt.

-- One-way follows. status is pending only for a private account awaiting
-- approval; every follow created today is accepted.
CREATE TABLE IF NOT EXISTS "follows" (
  "follower_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "followee_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'accepted' CHECK ("status" IN ('accepted', 'pending')),
  "created_at" integer NOT NULL,
  PRIMARY KEY ("follower_id", "followee_id"),
  CHECK ("follower_id" <> "followee_id")
);

CREATE INDEX IF NOT EXISTS "follows_followee_idx"
  ON "follows" ("followee_id", "status");

-- A block hides both people from each other everywhere in the social layer.
CREATE TABLE IF NOT EXISTS "blocks" (
  "blocker_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "blocked_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("blocker_id", "blocked_id"),
  CHECK ("blocker_id" <> "blocked_id")
);

CREATE INDEX IF NOT EXISTS "blocks_blocked_idx" ON "blocks" ("blocked_id");

-- The four-step taste verdict, and the halal check a diner made on the same
-- visit. The check itself is an ordinary pending verification that goes through
-- moderation like any other; this column only links the two.
ALTER TABLE "place_check_ins"
  ADD COLUMN "verdict" text CHECK ("verdict" IS NULL OR "verdict" IN ('disliked', 'okay', 'liked', 'favourite'));

ALTER TABLE "place_check_ins"
  ADD COLUMN "halal_verification_id" text REFERENCES "place_halal_verifications"("id") ON DELETE SET NULL;

-- One row per shareable event. The feed is assembled on read from the people a
-- viewer follows, so there is nothing to fan out or clean up per follower.
CREATE TABLE IF NOT EXISTS "feed_events" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('visit')),
  "visit_id" text NOT NULL UNIQUE REFERENCES "place_visits"("id") ON DELETE CASCADE,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "feed_events_actor_idx"
  ON "feed_events" ("actor_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "reactions" (
  "visit_id" text NOT NULL REFERENCES "place_visits"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL DEFAULT 'like' CHECK ("kind" IN ('like')),
  "created_at" integer NOT NULL,
  PRIMARY KEY ("visit_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "reactions_user_idx" ON "reactions" ("user_id");

CREATE TABLE IF NOT EXISTS "comments" (
  "id" text PRIMARY KEY NOT NULL,
  "visit_id" text NOT NULL REFERENCES "place_visits"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "body" text NOT NULL CHECK (length("body") BETWEEN 1 AND 500),
  "status" text NOT NULL DEFAULT 'visible' CHECK ("status" IN ('visible', 'hidden')),
  "created_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "comments_visit_idx"
  ON "comments" ("visit_id", "created_at");
