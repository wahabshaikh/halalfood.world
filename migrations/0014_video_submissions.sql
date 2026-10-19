-- Video paste (spec §5.1): a member pastes a YouTube link, we cache its metadata once, and the member picks the
-- places it shows. Additive only.
--
-- One video_submissions row per video. The first paste fetches oEmbed and, when YOUTUBE_API_KEY is set, one
-- videos.list and one channels.list call; later pastes read the cached meta. Each member's place picks are
-- `contributions` rows (kind 'video', ref_table 'video_submissions', ref_id = this id, one per place), so a
-- second submitter never duplicates the video. New-tier picks stay pending for /admin; the rest publish
-- creator_verifications (source 'member') at once. A creator verification is context, never evidence: it feeds
-- trust (lib/trust.ts), not halal status.
--
-- Enumerations have no CHECK, like contributions; lib/core/videos.ts validates them.
--   video_submissions.platform   youtube
--   video_submissions.status     fetched | needs_review | published | rejected
--   creator_links.kind           youtube | instagram | tiktok | x | website | facebook
--   creator_links.source         youtube_about | member | scout
-- Safe to run again: every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "video_submissions" (
  "id" text PRIMARY KEY NOT NULL,
  -- Who pasted it first.
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "platform" text NOT NULL DEFAULT 'youtube',
  "video_id" text NOT NULL,
  -- Canonical https://www.youtube.com/watch?v=<id>.
  "url" text NOT NULL,
  "status" text NOT NULL,
  -- The creator's user row, once the channel is known (Data API, or an existing creator matched by handle).
  "creator_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  -- oEmbed + Data API fields we keep, as JSON, with fetchedAt. Re-fetched after 30 days.
  "meta" text NOT NULL DEFAULT '{}',
  -- Places published from this video, as a JSON array of place ids.
  "place_ids" text NOT NULL DEFAULT '[]',
  -- How it was first submitted: web | mcp.
  "channel" text NOT NULL DEFAULT 'web',
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "video_submissions_video_idx" ON "video_submissions" ("platform", "video_id");
CREATE INDEX IF NOT EXISTS "video_submissions_status_idx" ON "video_submissions" ("status", "updated_at");

-- A creator's social presence, shown on their page. One link per kind.
CREATE TABLE IF NOT EXISTS "creator_links" (
  "creator_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "url" text NOT NULL CHECK (length("url") <= 300),
  "source" text NOT NULL,
  "created_at" integer NOT NULL,
  PRIMARY KEY ("creator_user_id", "kind")
);

-- The admin Videos queue and the daily quota read video contributions by status and by member.
CREATE INDEX IF NOT EXISTS "contributions_ref_idx" ON "contributions" ("ref_table", "ref_id", "status");

-- Retries and concurrent picks cannot duplicate an active member/video/place contribution.
CREATE UNIQUE INDEX IF NOT EXISTS "contributions_video_pick_idx"
  ON "contributions" ("user_id", "ref_id", "place_id")
  WHERE "kind" = 'video' AND "ref_table" = 'video_submissions' AND "status" IN ('pending', 'accepted');
