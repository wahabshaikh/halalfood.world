-- Creator profiles and the places creators verify in their videos. Additive only.
--
-- Halal Food Scout (the admin MCP endpoint at /api/mcp) finds halal food YouTube
-- creators and records which places they show in their videos. A creator is an
-- ordinary `user` + `profiles` row, so it renders at /u/<handle>; the channel
-- details live here. Nobody can sign in as an unclaimed creator: its `user.email`
-- is a placeholder under the reserved `.invalid` TLD, which the auth route refuses.
--
-- A creator verification is context, never evidence: it does not feed
-- lib/core/halal.ts or place_status (docs/spec/halal-model.md).

CREATE TABLE "creator_profiles" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "platform" text NOT NULL DEFAULT 'youtube' CHECK ("platform" IN ('youtube')),
  -- YouTube channel id (UC + 22 characters). Case-sensitive; the stable identity.
  "channel_id" text NOT NULL,
  -- The channel's @handle, lowercased, without @. The profile handle usually matches it.
  "channel_handle" text NOT NULL,
  "channel_url" text NOT NULL,
  -- External https image URLs on YouTube's image hosts; rendered directly, never fetched.
  "avatar_url" text,
  "banner_url" text,
  "subscriber_count" integer,
  -- Who created the row: 'scout' for the MCP importer.
  "source" text NOT NULL DEFAULT 'scout',
  -- Set when the creator proves they own the channel. Scout never changes a claimed row.
  "claimed_at" integer,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE UNIQUE INDEX "creator_profiles_channel_idx" ON "creator_profiles" ("platform", "channel_id");
CREATE INDEX "creator_profiles_channel_handle_idx" ON "creator_profiles" ("platform", "channel_handle");

CREATE TABLE "creator_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "creator_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "platform" text NOT NULL DEFAULT 'youtube' CHECK ("platform" IN ('youtube')),
  "video_id" text NOT NULL,
  -- Canonical https://www.youtube.com/watch?v=<id>, without a timestamp.
  "video_url" text NOT NULL,
  -- Where in the video the place appears, in seconds.
  "timestamp_seconds" integer,
  -- The video's publish date, YYYY-MM-DD.
  "video_date" text,
  -- The place_media_links row this verification added, so removing it removes only that row.
  "media_link_id" text REFERENCES "place_media_links"("id") ON DELETE SET NULL,
  "source" text NOT NULL DEFAULT 'scout',
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE UNIQUE INDEX "creator_verifications_unique_idx" ON "creator_verifications" ("creator_user_id", "place_id", "video_id");
CREATE INDEX "creator_verifications_place_idx" ON "creator_verifications" ("place_id", "created_at" DESC);
