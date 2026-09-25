-- Creator videos linked to places from Instagram, TikTok and YouTube URLs.
-- D1/SQLite dialect. Author fields come from the platform's public oEmbed
-- response when one is available; they are never typed in by hand.

CREATE TABLE IF NOT EXISTS "place_media_links" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "submitted_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "platform" text NOT NULL CHECK ("platform" IN ('instagram', 'tiktok', 'youtube')),
  "url" text NOT NULL,
  "author_handle" text,
  "author_name" text,
  "title" text,
  "thumbnail_url" text,
  "created_at" integer NOT NULL,
  UNIQUE ("place_id", "url")
);

CREATE INDEX IF NOT EXISTS "place_media_links_place_created_idx"
  ON "place_media_links" ("place_id", "created_at");

CREATE INDEX IF NOT EXISTS "place_media_links_author_idx"
  ON "place_media_links" ("platform", "author_handle");
