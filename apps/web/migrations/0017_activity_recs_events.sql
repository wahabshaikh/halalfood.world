-- Activity, recs and events, phase 4 of the social community design. D1/SQLite
-- dialect. Nothing here feeds halal status: a notification reports a change, a
-- rec is taste, an RSVP is planning, and a leaderboard rank is context.
-- Keep comments here free of quote characters: the remote migration runner
-- splits statements with a quote-aware scanner that does not skip comments,
-- and it refuses DROP TABLE, so nothing is rebuilt.

-- One row per thing a diner should hear about. dedupe_key keeps a single event
-- from notifying the same diner twice, so liking, unliking and liking again
-- says nothing new. Likes on one visit are folded together when read.
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN (
    'status-changed', 'check-reviewed', 'follow', 'follow-request',
    'follow-accepted', 'like', 'comment', 'friend-visit', 'list-invite',
    'list-places-added', 'rec', 'rec-reply'
  )),
  "actor_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" text REFERENCES "places"("id") ON DELETE CASCADE,
  "visit_id" text REFERENCES "place_visits"("id") ON DELETE CASCADE,
  "list_id" text REFERENCES "place_lists"("id") ON DELETE CASCADE,
  "rec_id" text,
  "status_change_id" text REFERENCES "place_halal_status_history"("id") ON DELETE CASCADE,
  "verification_id" text REFERENCES "place_halal_verifications"("id") ON DELETE CASCADE,
  "dedupe_key" text NOT NULL,
  "created_at" integer NOT NULL,
  "read_at" integer
);

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_idx"
  ON "notifications" ("user_id", "dedupe_key");

CREATE INDEX IF NOT EXISTS "notifications_user_idx"
  ON "notifications" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "notifications_unread_idx"
  ON "notifications" ("user_id", "read_at");

CREATE INDEX IF NOT EXISTS "notifications_actor_idx"
  ON "notifications" ("actor_id");

-- A place or a list sent to a friend with a short note. There is no chat: the
-- only reply is one of two fixed answers.
CREATE TABLE IF NOT EXISTS "recs" (
  "id" text PRIMARY KEY NOT NULL,
  "sender_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "recipient_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" text REFERENCES "places"("id") ON DELETE CASCADE,
  "list_id" text REFERENCES "place_lists"("id") ON DELETE CASCADE,
  "note" text CHECK ("note" IS NULL OR length("note") <= 140),
  "reply" text CHECK ("reply" IS NULL OR "reply" IN ('in', 'want-to-try')),
  "replied_at" integer,
  "read_at" integer,
  "created_at" integer NOT NULL,
  CHECK ("sender_id" <> "recipient_id"),
  CHECK (("place_id" IS NULL) <> ("list_id" IS NULL))
);

-- The same place or list goes to the same friend once.
CREATE UNIQUE INDEX IF NOT EXISTS "recs_once_idx"
  ON "recs" ("sender_id", "recipient_id", COALESCE("place_id", "list_id"));

CREATE INDEX IF NOT EXISTS "recs_recipient_idx"
  ON "recs" ("recipient_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "recs_sender_idx"
  ON "recs" ("sender_id", "created_at" DESC);

-- Halal food events. Moderators publish them. Every vendor carries its own
-- status, taken from the linked place when there is one.
CREATE TABLE IF NOT EXISTS "events" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL CHECK (length("title") BETWEEN 1 AND 80),
  "description" text CHECK ("description" IS NULL OR length("description") <= 600),
  "city_slug" text NOT NULL,
  "venue" text NOT NULL,
  "address" text,
  "starts_at" integer NOT NULL,
  "ends_at" integer,
  "status" text NOT NULL DEFAULT 'published' CHECK ("status" IN ('published', 'cancelled')),
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "events_city_idx"
  ON "events" ("city_slug", "starts_at");

CREATE INDEX IF NOT EXISTS "events_starts_idx"
  ON "events" ("status", "starts_at");

CREATE TABLE IF NOT EXISTS "event_vendors" (
  "id" text PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "note" text,
  "place_id" text REFERENCES "places"("id") ON DELETE SET NULL,
  "position" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "event_vendors_event_idx"
  ON "event_vendors" ("event_id", "position");

CREATE INDEX IF NOT EXISTS "event_vendors_place_idx"
  ON "event_vendors" ("place_id");

CREATE TABLE IF NOT EXISTS "event_rsvps" (
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("event_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "event_rsvps_user_idx"
  ON "event_rsvps" ("user_id", "created_at" DESC);

-- Show me on leaderboards. On by default, and a private account is never listed
-- whatever this says.
ALTER TABLE "user_profiles" ADD COLUMN "show_on_leaderboards" integer NOT NULL DEFAULT 1;

-- The weekly board reads verified visits inside a time window across all diners.
CREATE INDEX IF NOT EXISTS "place_visits_visited_idx"
  ON "place_visits" ("visited_at" DESC);
