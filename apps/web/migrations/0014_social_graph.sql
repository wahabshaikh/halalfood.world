-- Social graph and onboarding, phase 1 of the social community design.
-- D1/SQLite dialect. Halal status never reads from these tables: follows and
-- blocks decide who sees whose activity, never what a badge says.
-- Keep comments here free of quote characters: the remote migration runner
-- splits statements with a quote-aware scanner that does not skip comments.

-- Profile photo (an R2 key under avatars/), private-account switch, the time
-- onboarding finished and the diner whose invite link brought this one in.
ALTER TABLE "user_profiles" ADD COLUMN "avatar_key" text;
ALTER TABLE "user_profiles" ADD COLUMN "is_private" integer NOT NULL DEFAULT 0;
ALTER TABLE "user_profiles" ADD COLUMN "onboarded_at" integer;
ALTER TABLE "user_profiles" ADD COLUMN "invited_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL;

-- Profiles that already exist predate onboarding, so they are not sent back
-- through it.
UPDATE "user_profiles" SET "onboarded_at" = "updated_at" WHERE "onboarded_at" IS NULL;

-- Zabiha preference chosen during onboarding. Stored with the other dietary
-- standards so every later screen can filter by it.
ALTER TABLE "user_preferences" ADD COLUMN "prefer_hand_slaughter" integer NOT NULL DEFAULT 0;

-- One-way follows. A follow of a private account stays pending until the
-- followee accepts it.
CREATE TABLE IF NOT EXISTS "follows" (
  "follower_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "followee_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'accepted' CHECK ("status" IN ('pending', 'accepted')),
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  PRIMARY KEY ("follower_id", "followee_id"),
  CHECK ("follower_id" <> "followee_id")
);

CREATE INDEX IF NOT EXISTS "follows_followee_idx"
  ON "follows" ("followee_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "follows_follower_idx"
  ON "follows" ("follower_id", "status", "created_at");

-- Blocks hide both people from each other and remove any follow between them.
CREATE TABLE IF NOT EXISTS "user_blocks" (
  "blocker_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "blocked_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("blocker_id", "blocked_id"),
  CHECK ("blocker_id" <> "blocked_id")
);

CREATE INDEX IF NOT EXISTS "user_blocks_blocked_idx"
  ON "user_blocks" ("blocked_id");
