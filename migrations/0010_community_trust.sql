-- Community contributions, vouches, member trust and contribution points, plus place trust columns. Additive only.
--
-- Trust says how much real-world proof stands behind a listing; it never touches the four facts, which stay
-- with lib/core/halal.ts (docs/spec/halal-model.md). Ratings, points and sponsorship never touch either.
-- The rules are pure functions: member weight, place trust score, band and badges in lib/core/trust.ts, and
-- contribution kinds, statuses and points in lib/core/contributions.ts. Nothing reads these tables yet.
--
-- Enumerations have no CHECK, like place_claims: widening a CHECK means rebuilding the table, so the lib/core
-- modules validate them instead.
--   contributions.kind              vouch | place_add | video | photo | menu | certificate | owner_claim | edit
--                                   | rating | amenity | hours | link
--   contributions.channel           web | mcp | scout
--   contributions.status            pending | accepted | rejected | reverted
--   vouches.rating                  disliked | liked | loved
--   member_trust.tier               restricted | new | member | trusted | moderator
--   contribution_points.status      pending | granted | revoked
--   place_status.trust_band         unverified | some_proof | trusted | highly_trusted
-- Place rows follow their place on a moderator merge (ON UPDATE CASCADE). Safe to run again: every statement is
-- IF NOT EXISTS except the ALTER TABLEs at the end, which rely on wrangler's d1_migrations record to run once.

-- Every piece of community work: who, what, where, how (channel) and when. The one audit and points source.
-- Kept when the place goes (place_id goes null) so trust and points can still be recomputed and reverted.
CREATE TABLE IF NOT EXISTS "contributions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "place_id" text REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- The row the contribution made, such as vouches or place_signals, and its id (vouches use user_id:place_id).
  "ref_table" text,
  "ref_id" text,
  "channel" text NOT NULL,
  "status" text NOT NULL,
  -- The member's weight when it was counted (lib/core/trust.ts), after modifiers.
  "weight" real NOT NULL DEFAULT 0,
  -- Hashed IP /24, for cluster damping. Never the raw address.
  "ip_hash" text,
  -- The member API key behind an MCP write.
  "api_key_id" text,
  "created_at" integer NOT NULL,
  "reviewed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "reviewed_at" integer,
  -- Why a moderator rejected or reverted it.
  "reason" text CHECK ("reason" IS NULL OR length("reason") <= 300)
);
CREATE INDEX IF NOT EXISTS "contributions_user_idx" ON "contributions" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "contributions_place_idx" ON "contributions" ("place_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "contributions_status_idx" ON "contributions" ("status", "created_at");

-- "I ate here and it's halal." One per member and place: a newer vouch replaces the older one.
CREATE TABLE IF NOT EXISTS "vouches" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Month eaten, YYYY-MM.
  "ate_at" text NOT NULL CHECK (length("ate_at") = 7),
  "rating" text,
  "note" text CHECK ("note" IS NULL OR length("note") <= 280),
  -- The four-question check written from "add details", if any.
  "check_id" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  PRIMARY KEY ("user_id", "place_id")
);
CREATE INDEX IF NOT EXISTS "vouches_place_idx" ON "vouches" ("place_id", "updated_at" DESC);

-- A projection of each member's tier and weight (lib/core/trust.ts memberTrust), recomputed after a review.
CREATE TABLE IF NOT EXISTS "member_trust" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "tier" text NOT NULL,
  "weight" real NOT NULL,
  "accepted" integer NOT NULL DEFAULT 0,
  "rejected" integer NOT NULL DEFAULT 0,
  "upheld_reports_90d" integer NOT NULL DEFAULT 0,
  "updated_at" integer NOT NULL
);

-- Points v2 (the old points CHECK can't widen). Pending until the contribution is accepted, then granted;
-- revoked when it is rejected or reverted. day is the UTC day granted (YYYY-MM-DD), for the daily cap.
CREATE TABLE IF NOT EXISTS "contribution_points" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "contribution_id" text NOT NULL REFERENCES "contributions"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "place_id" text REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "city_slug" text,
  "points" integer NOT NULL,
  "status" text NOT NULL,
  "day" text NOT NULL,
  "created_at" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "contribution_points_user_day_idx" ON "contribution_points" ("user_id", "day", "status");
CREATE INDEX IF NOT EXISTS "contribution_points_contribution_idx" ON "contribution_points" ("contribution_id");

-- Place trust (lib/core/trust.ts placeTrust), next to the halal status it never changes.
-- badges is comma-separated, like the *_sources columns.
ALTER TABLE "place_status" ADD COLUMN "trust_score" integer NOT NULL DEFAULT 0;
ALTER TABLE "place_status" ADD COLUMN "trust_band" text NOT NULL DEFAULT 'unverified';
ALTER TABLE "place_status" ADD COLUMN "community_vouchers" integer NOT NULL DEFAULT 0;
ALTER TABLE "place_status" ADD COLUMN "creator_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "place_status" ADD COLUMN "badges" text NOT NULL DEFAULT '';
