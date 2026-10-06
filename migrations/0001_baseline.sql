-- halalfood.world baseline schema.
-- See docs/product/simplified-community-spec.md §4. D1/SQLite dialect.
-- Timestamps are Unix epoch milliseconds. Booleans are 0/1 integers.

-- ---------------------------------------------------------------------------
-- Auth (Better Auth)
-- ---------------------------------------------------------------------------

CREATE TABLE "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "email_verified" integer NOT NULL DEFAULT 0,
  "image" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE TABLE "session" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" integer NOT NULL,
  "token" text NOT NULL UNIQUE,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");

CREATE TABLE "account" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" integer,
  "refresh_token_expires_at" integer,
  "scope" text,
  "password" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");

CREATE TABLE "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" integer NOT NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE "rate_limit" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL,
  "last_request" integer NOT NULL
);
CREATE INDEX "rate_limit_last_request_idx" ON "rate_limit" ("last_request");

-- Durable action budgets (OTP, saves, checks…). Keys are hashed and scoped.
CREATE TABLE "auth_otp_rate_limit" (
  "key" text PRIMARY KEY NOT NULL,
  "window_started_at" integer NOT NULL,
  "window_count" integer NOT NULL,
  "last_action_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX "auth_otp_rate_limit_updated_at_idx" ON "auth_otp_rate_limit" ("updated_at");

-- ---------------------------------------------------------------------------
-- Ops
-- ---------------------------------------------------------------------------

CREATE TABLE "google_search_daily" (
  "day" text PRIMARY KEY NOT NULL,
  "call_count" integer NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE TABLE "moderators" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'moderator' CHECK ("role" IN ('moderator', 'admin')),
  "created_at" integer NOT NULL
);

CREATE TABLE "audit_log" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_user_id" text,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "reason" text,
  "before_value" text,
  "after_value" text,
  "created_at" integer NOT NULL
);
CREATE INDEX "audit_log_target_idx" ON "audit_log" ("target_type", "target_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------

CREATE TABLE "places" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "city_slug" text NOT NULL,
  "street_address" text NOT NULL,
  "address_locality" text,
  "address_region" text,
  "postal_code" text,
  "address_country" text,
  "telephone" text,
  "website" text,
  "maps_url" text,
  "google_place_id" text,
  "serves_cuisine" text NOT NULL DEFAULT '[]',
  "lat" real,
  "lng" real,
  "submitted_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "listing_status" text NOT NULL DEFAULT 'listed' CHECK ("listing_status" IN ('listed', 'hidden', 'closed')),
  "google_details_snapshot" text,
  "google_details_cached_at" integer,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE UNIQUE INDEX "places_google_place_id_unique_idx" ON "places" ("google_place_id") WHERE "google_place_id" IS NOT NULL;
CREATE UNIQUE INDEX "places_city_name_address_unique_idx" ON "places" ("city_slug", "name", "street_address");
CREATE INDEX "places_listed_city_idx" ON "places" ("city_slug", "id") WHERE "listing_status" = 'listed';
CREATE INDEX "places_listed_lat_lng_idx" ON "places" ("lat", "lng") WHERE "listing_status" = 'listed' AND "lat" IS NOT NULL AND "lng" IS NOT NULL;
CREATE INDEX "places_submitted_by_idx" ON "places" ("submitted_by_user_id");

-- Projection of the halal status (spec §2.5). One row per place, rewritten on
-- every check. Discovery filters on it with plain SQL.
CREATE TABLE "place_status" (
  "place_id" text PRIMARY KEY NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'unchecked' CHECK ("status" IN ('verified', 'checking', 'unchecked')),
  "progress" integer NOT NULL DEFAULT 0 CHECK ("progress" BETWEEN 0 AND 3),
  "owned_value" text CHECK ("owned_value" IN ('yes', 'no')),
  "owned_streak" integer NOT NULL DEFAULT 0,
  "owned_settled" text CHECK ("owned_settled" IN ('yes', 'no')),
  "certified_value" text CHECK ("certified_value" IN ('yes', 'no')),
  "certified_streak" integer NOT NULL DEFAULT 0,
  "certified_settled" text CHECK ("certified_settled" IN ('yes', 'no')),
  "pork_value" text CHECK ("pork_value" IN ('yes', 'no')),
  "pork_streak" integer NOT NULL DEFAULT 0,
  "pork_settled" text CHECK ("pork_settled" IN ('yes', 'no')),
  "alcohol_value" text CHECK ("alcohol_value" IN ('yes', 'no')),
  "alcohol_streak" integer NOT NULL DEFAULT 0,
  "alcohol_settled" text CHECK ("alcohol_settled" IN ('yes', 'no')),
  "eligible_checks" integer NOT NULL DEFAULT 0,
  "last_checked_at" integer,
  "verified_at" integer,
  "updated_at" integer NOT NULL
);
CREATE INDEX "place_status_status_idx" ON "place_status" ("status");

CREATE TABLE "place_status_changes" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "from_status" text NOT NULL,
  "to_status" text NOT NULL,
  "fact" text,
  "from_value" text,
  "to_value" text,
  "created_at" integer NOT NULL
);
CREATE INDEX "place_status_changes_place_idx" ON "place_status_changes" ("place_id", "created_at" DESC);

CREATE TABLE "saved_places" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("user_id", "place_id")
);
CREATE INDEX "saved_places_user_idx" ON "saved_places" ("user_id", "created_at" DESC);
CREATE INDEX "saved_places_place_idx" ON "saved_places" ("place_id");

CREATE TABLE "place_media_links" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "submitted_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "platform" text NOT NULL CHECK ("platform" IN ('instagram', 'tiktok', 'youtube')),
  "url" text NOT NULL,
  "author_handle" text,
  "author_name" text,
  "title" text,
  "thumbnail_url" text,
  "created_at" integer NOT NULL
);
CREATE UNIQUE INDEX "place_media_links_place_url_idx" ON "place_media_links" ("place_id", "url");
CREATE INDEX "place_media_links_place_idx" ON "place_media_links" ("place_id", "created_at" DESC);
CREATE INDEX "place_media_links_author_idx" ON "place_media_links" ("platform", "author_handle");

-- ---------------------------------------------------------------------------
-- Checks (the only input to halal status) and what rides along with them
-- ---------------------------------------------------------------------------

CREATE TABLE "checks" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "owned" text CHECK ("owned" IN ('yes', 'no', 'unsure')),
  "certified" text CHECK ("certified" IN ('yes', 'no', 'unsure')),
  "pork" text CHECK ("pork" IN ('yes', 'no', 'unsure')),
  "alcohol" text CHECK ("alcohol" IN ('yes', 'no', 'unsure')),
  "verdict" text CHECK ("verdict" IN ('no', 'okay', 'liked', 'loved')),
  "note" text CHECK ("note" IS NULL OR length("note") <= 500),
  "shared" integer NOT NULL DEFAULT 1,
  "excluded" integer NOT NULL DEFAULT 0,
  "idempotency_key" text NOT NULL,
  "created_at" integer NOT NULL,
  CHECK ("owned" IN ('yes', 'no') OR "certified" IN ('yes', 'no') OR "pork" IN ('yes', 'no') OR "alcohol" IN ('yes', 'no'))
);
CREATE UNIQUE INDEX "checks_user_idempotency_idx" ON "checks" ("user_id", "idempotency_key");
CREATE INDEX "checks_place_idx" ON "checks" ("place_id", "created_at" DESC);
CREATE INDEX "checks_user_idx" ON "checks" ("user_id", "created_at" DESC);
CREATE INDEX "checks_user_place_idx" ON "checks" ("user_id", "place_id", "created_at" DESC);

CREATE TABLE "check_dishes" (
  "check_id" text NOT NULL REFERENCES "checks"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "name" text NOT NULL CHECK (length("name") BETWEEN 1 AND 60),
  PRIMARY KEY ("check_id", "position")
);

CREATE TABLE "place_photos" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "check_id" text REFERENCES "checks"("id") ON DELETE SET NULL,
  "r2_key" text NOT NULL UNIQUE,
  "content_type" text NOT NULL CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
  "byte_size" integer NOT NULL CHECK ("byte_size" BETWEEN 1 AND 8388608),
  "created_at" integer NOT NULL
);
CREATE INDEX "place_photos_place_idx" ON "place_photos" ("place_id", "created_at" DESC);
CREATE INDEX "place_photos_check_idx" ON "place_photos" ("check_id");

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE "profiles" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "handle" text NOT NULL UNIQUE,
  "display_name" text,
  "bio" text CHECK ("bio" IS NULL OR length("bio") <= 160),
  "avatar_key" text,
  "home_city_slug" text,
  "is_private" integer NOT NULL DEFAULT 0,
  "lists_private_default" integer NOT NULL DEFAULT 0,
  "show_on_leaderboards" integer NOT NULL DEFAULT 1,
  "default_filters" text NOT NULL DEFAULT '[]',
  "onboarded_at" integer,
  "invited_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "suspended_at" integer,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE TABLE "follows" (
  "follower_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "followee_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'accepted' CHECK ("status" IN ('pending', 'accepted')),
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  PRIMARY KEY ("follower_id", "followee_id"),
  CHECK ("follower_id" <> "followee_id")
);
CREATE INDEX "follows_followee_idx" ON "follows" ("followee_id", "status", "created_at");
CREATE INDEX "follows_follower_idx" ON "follows" ("follower_id", "status", "created_at");

CREATE TABLE "blocks" (
  "blocker_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "blocked_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("blocker_id", "blocked_id")
);
CREATE INDEX "blocks_blocked_idx" ON "blocks" ("blocked_id");

-- ---------------------------------------------------------------------------
-- Social
-- ---------------------------------------------------------------------------

CREATE TABLE "likes" (
  "check_id" text NOT NULL REFERENCES "checks"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("check_id", "user_id")
);
CREATE INDEX "likes_user_idx" ON "likes" ("user_id");

CREATE TABLE "comments" (
  "id" text PRIMARY KEY NOT NULL,
  "check_id" text NOT NULL REFERENCES "checks"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "body" text NOT NULL CHECK (length(trim("body")) BETWEEN 1 AND 500),
  "status" text NOT NULL DEFAULT 'visible' CHECK ("status" IN ('visible', 'hidden')),
  "created_at" integer NOT NULL
);
CREATE INDEX "comments_check_idx" ON "comments" ("check_id", "created_at");

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------

CREATE TABLE "lists" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('ranked', 'plan', 'guide')),
  "title" text NOT NULL CHECK (length(trim("title")) BETWEEN 1 AND 80),
  "caption" text CHECK ("caption" IS NULL OR length("caption") <= 200),
  "visibility" text NOT NULL DEFAULT 'public' CHECK ("visibility" IN ('public', 'followers', 'private')),
  "city_slug" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX "lists_owner_idx" ON "lists" ("owner_id", "updated_at" DESC);
CREATE INDEX "lists_city_kind_idx" ON "lists" ("city_slug", "kind");

CREATE TABLE "list_items" (
  "list_id" text NOT NULL REFERENCES "lists"("id") ON DELETE CASCADE,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "note" text CHECK ("note" IS NULL OR length("note") <= 140),
  "added_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("list_id", "place_id")
);
CREATE INDEX "list_items_order_idx" ON "list_items" ("list_id", "position");
CREATE INDEX "list_items_place_idx" ON "list_items" ("place_id");

CREATE TABLE "list_members" (
  "list_id" text NOT NULL REFERENCES "lists"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'invited' CHECK ("status" IN ('invited', 'accepted')),
  "invited_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("list_id", "user_id")
);
CREATE INDEX "list_members_user_idx" ON "list_members" ("user_id", "status");

CREATE TABLE "list_saves" (
  "list_id" text NOT NULL REFERENCES "lists"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("list_id", "user_id")
);
CREATE INDEX "list_saves_user_idx" ON "list_saves" ("user_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

CREATE TABLE "events" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "city_slug" text NOT NULL,
  "venue" text NOT NULL,
  "address" text,
  "starts_at" integer NOT NULL,
  "ends_at" integer,
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'cancelled')),
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX "events_city_idx" ON "events" ("city_slug", "starts_at");
CREATE INDEX "events_status_idx" ON "events" ("status", "starts_at");

CREATE TABLE "event_vendors" (
  "id" text PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "note" text,
  "place_id" text REFERENCES "places"("id") ON DELETE SET NULL,
  "position" integer NOT NULL DEFAULT 0
);
CREATE INDEX "event_vendors_event_idx" ON "event_vendors" ("event_id", "position");
CREATE INDEX "event_vendors_place_idx" ON "event_vendors" ("place_id");

CREATE TABLE "event_rsvps" (
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("event_id", "user_id")
);
CREATE INDEX "event_rsvps_user_idx" ON "event_rsvps" ("user_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- Recs and notifications
-- ---------------------------------------------------------------------------

CREATE TABLE "recs" (
  "id" text PRIMARY KEY NOT NULL,
  "sender_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "recipient_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" text REFERENCES "places"("id") ON DELETE CASCADE,
  "list_id" text REFERENCES "lists"("id") ON DELETE CASCADE,
  "event_id" text REFERENCES "events"("id") ON DELETE CASCADE,
  "note" text CHECK ("note" IS NULL OR length("note") <= 140),
  "reply" text CHECK ("reply" IN ('in', 'want-to-try')),
  "replied_at" integer,
  "read_at" integer,
  "created_at" integer NOT NULL,
  CHECK ((("place_id" IS NOT NULL) + ("list_id" IS NOT NULL) + ("event_id" IS NOT NULL)) = 1)
);
CREATE INDEX "recs_recipient_idx" ON "recs" ("recipient_id", "created_at" DESC);
CREATE INDEX "recs_sender_idx" ON "recs" ("sender_id", "created_at" DESC);

CREATE TABLE "notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN (
    'status-changed', 'follow', 'follow-request', 'follow-accepted', 'like', 'comment',
    'friend-visit', 'list-invite', 'rec-reply', 'invite-joined'
  )),
  "actor_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" text REFERENCES "places"("id") ON DELETE CASCADE,
  "check_id" text REFERENCES "checks"("id") ON DELETE CASCADE,
  "list_id" text REFERENCES "lists"("id") ON DELETE CASCADE,
  "rec_id" text REFERENCES "recs"("id") ON DELETE CASCADE,
  "status_change_id" text REFERENCES "place_status_changes"("id") ON DELETE CASCADE,
  "dedupe_key" text NOT NULL,
  "created_at" integer NOT NULL,
  "read_at" integer
);
CREATE UNIQUE INDEX "notifications_dedupe_idx" ON "notifications" ("user_id", "dedupe_key");
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id", "created_at" DESC);
CREATE INDEX "notifications_unread_idx" ON "notifications" ("user_id", "read_at");

-- ---------------------------------------------------------------------------
-- Community points (append-only ledger, spec §10)
-- ---------------------------------------------------------------------------

CREATE TABLE "points" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('check', 'place-added', 'helped-verify')),
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "check_id" text REFERENCES "checks"("id") ON DELETE CASCADE,
  "city_slug" text NOT NULL,
  "points" integer NOT NULL,
  "day" text NOT NULL,
  "created_at" integer NOT NULL
);
CREATE UNIQUE INDEX "points_once_per_day_idx" ON "points" ("user_id", "kind", "place_id", "day");
CREATE INDEX "points_city_idx" ON "points" ("city_slug", "created_at");
CREATE INDEX "points_user_idx" ON "points" ("user_id");

-- ---------------------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------------------

CREATE TABLE "reports" (
  "id" text PRIMARY KEY NOT NULL,
  "target_type" text NOT NULL CHECK ("target_type" IN ('place', 'check', 'comment', 'user', 'list')),
  "target_id" text NOT NULL,
  "reporter_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "reason" text NOT NULL,
  "detail" text CHECK ("detail" IS NULL OR length("detail") <= 500),
  "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'actioned', 'dismissed')),
  "action" text,
  "reviewed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX "reports_status_idx" ON "reports" ("status", "created_at");
CREATE INDEX "reports_target_idx" ON "reports" ("target_type", "target_id");
