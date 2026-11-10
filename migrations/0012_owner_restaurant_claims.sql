-- Paid restaurant claims ("Claim your restaurant"). Additive only.
--
-- A claim is a subscription, not a halal fact. Payment never writes place_status.
-- The public "Claimed by the restaurant" line and the city's Sponsored block require
-- review_status = 'approved' and a live paid window (lib/core/owner-claim.ts).
-- Hours and the owner menu are the restaurant's own copy. They are not Scout menus
-- and they do not feed lib/core/halal.ts. A certificate photo still goes through
-- place_signals as review_status = 'pending', the same queue as any other certificate.
--
-- status        pending | active | refunded | removed | ended
-- review_status pending | approved | rejected
-- role          owner | manager
-- Enumerations have no CHECK, so a later state does not rebuild the table.
-- place_photos.listed_by marks photos the claimed restaurant added ('restaurant').
-- Existing rows stay 'member'. The column does not change halal status.
--
-- Safe to run again: CREATE statements use IF NOT EXISTS. The ALTER TABLE runs once,
-- because wrangler records the migration (SQLite has no ADD COLUMN IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "owner_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  -- Kept as NULL when the account is deleted. The contact email is cleared in deleteAccount.
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "role" text NOT NULL,
  "contact_email" text NOT NULL CHECK (length("contact_email") <= 120),
  "status" text NOT NULL,
  "review_status" text NOT NULL DEFAULT 'pending',
  "renews" integer NOT NULL DEFAULT 1,
  "whop_checkout_id" text,
  "whop_membership_id" text,
  "whop_payment_id" text,
  "starts_at" integer,
  "active_until" integer,
  "reviewed_by_user_id" text,
  "reviewed_at" integer,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

-- One open checkout or paid claim per restaurant. Ended, refunded and removed rows stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS "owner_claims_open_place_idx" ON "owner_claims" ("place_id") WHERE "status" IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS "owner_claims_user_idx" ON "owner_claims" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "owner_claims_membership_idx" ON "owner_claims" ("whop_membership_id");
CREATE INDEX IF NOT EXISTS "owner_claims_payment_idx" ON "owner_claims" ("whop_payment_id");

-- Hours the restaurant typed. One row per place, replaced as a whole.
CREATE TABLE IF NOT EXISTS "owner_hours" (
  "place_id" text PRIMARY KEY NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "claim_id" text NOT NULL REFERENCES "owner_claims"("id") ON DELETE CASCADE,
  -- JSON array of seven days from parseOwnerHours: Monday is day 0.
  "week_json" text NOT NULL,
  "note" text CHECK ("note" IS NULL OR length("note") <= 160),
  "updated_at" integer NOT NULL
);

-- The restaurant's own menu, separate from place_menus (Scout). Replaced as a whole on save.
CREATE TABLE IF NOT EXISTS "owner_menu_items" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "claim_id" text NOT NULL REFERENCES "owner_claims"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "section" text CHECK ("section" IS NULL OR length("section") <= 80),
  "name" text NOT NULL CHECK (length("name") BETWEEN 1 AND 160),
  "description" text CHECK ("description" IS NULL OR length("description") <= 500),
  "price" real CHECK ("price" IS NULL OR "price" >= 0),
  "currency" text NOT NULL CHECK (length("currency") = 3)
);
CREATE INDEX IF NOT EXISTS "owner_menu_items_place_idx" ON "owner_menu_items" ("place_id", "position");

-- One row per place per UTC day. No IP, no user id: a count, not a profile.
CREATE TABLE IF NOT EXISTS "place_view_days" (
  "place_id" text NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
  "day" text NOT NULL,
  "views" integer NOT NULL CHECK ("views" >= 0),
  PRIMARY KEY ("place_id", "day")
);

ALTER TABLE "place_photos" ADD COLUMN "listed_by" text NOT NULL DEFAULT 'member';
