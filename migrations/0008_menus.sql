-- Restaurant menus as data, Halal Food Scout's menu checks, and place logos (/api/mcp). Additive only.
--
-- A menu here is a web source (docs/spec/halal-model.md): what the restaurant publishes, read by Halal Food Scout.
-- It is the same kind of evidence as a place_claims row, not the moderator-approved menu photo in place_signals
-- (source 'menu'), which settles pork and alcohol. Nothing in these tables feeds lib/core/halal.ts directly.
-- A flagged menu check may write a Scout claim (place_claims) under the usual claim rules; a clean one only
-- shows a badge and never sets or settles a fact (lib/core/menus.ts).
--
-- Enumerations have no CHECK, like place_claims: widening a CHECK means rebuilding the table, so
-- lib/core/menus.ts validates them instead.
--   place_menus.source              scout
--   place_menu_sources.type         website | zomato | swiggy | ubereats | deliveroo | doordash | google | other
--   place_menu_checks.status        clean | flagged | no_menu
--   place_menu_check_flags.reason   alcohol | pork | other
-- Child rows follow their place on a moderator merge (ON UPDATE CASCADE) and go with it (ON DELETE CASCADE).
-- Safe to run again: every statement is IF NOT EXISTS except the ALTER TABLEs at the end, which, as in earlier
-- migrations, rely on wrangler's d1_migrations record to run once (SQLite has no ADD COLUMN IF NOT EXISTS).

-- One menu per place. Upserting a menu replaces its items and sources as a whole.
CREATE TABLE IF NOT EXISTS "place_menus" (
  "place_id" text PRIMARY KEY NOT NULL REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "source" text NOT NULL DEFAULT 'scout',
  -- When Scout read the published menu.
  "captured_at" integer NOT NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "place_menu_items" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "place_menus"("place_id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Order on the published menu, from 0. Sections show in the order their first item appears.
  "position" integer NOT NULL,
  "section" text CHECK ("section" IS NULL OR length("section") <= 80),
  "name" text NOT NULL CHECK (length("name") BETWEEN 1 AND 160),
  "description" text CHECK ("description" IS NULL OR length("description") <= 500),
  -- In the currency's major unit (12.5 is £12.50), as published.
  "price" real NOT NULL CHECK ("price" >= 0),
  -- ISO 4217, upper case.
  "currency" text NOT NULL CHECK (length("currency") = 3)
);
CREATE INDEX IF NOT EXISTS "place_menu_items_place_idx" ON "place_menu_items" ("place_id", "position");

-- Where the menu was read: the place's own site or a delivery listing. Cited on the place page.
CREATE TABLE IF NOT EXISTS "place_menu_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "place_menus"("place_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "position" integer NOT NULL,
  "url" text NOT NULL CHECK (length("url") <= 500 AND "url" LIKE 'https://%'),
  "type" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "place_menu_sources_place_idx" ON "place_menu_sources" ("place_id", "position");

-- Scout's automated read of the published menu for alcohol and pork. One per place; a newer check replaces it.
CREATE TABLE IF NOT EXISTS "place_menu_checks" (
  "place_id" text PRIMARY KEY NOT NULL REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" text NOT NULL,
  "source" text NOT NULL DEFAULT 'scout',
  -- The https page the check read; a flagged check's Scout claims cite it.
  "source_url" text CHECK ("source_url" IS NULL OR (length("source_url") <= 500 AND "source_url" LIKE 'https://%')),
  "checked_at" integer NOT NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

-- What a flagged check found. item_id points at the menu item when the flag named one; it goes null when the menu
-- is replaced, and item_name keeps what was flagged.
CREATE TABLE IF NOT EXISTS "place_menu_check_flags" (
  "id" text PRIMARY KEY NOT NULL,
  "place_id" text NOT NULL REFERENCES "place_menu_checks"("place_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "position" integer NOT NULL,
  "item_id" text REFERENCES "place_menu_items"("id") ON DELETE SET NULL,
  "item_name" text NOT NULL CHECK (length("item_name") BETWEEN 1 AND 160),
  "reason" text NOT NULL,
  "note" text CHECK ("note" IS NULL OR length("note") <= 300)
);
CREATE INDEX IF NOT EXISTS "place_menu_check_flags_place_idx" ON "place_menu_check_flags" ("place_id", "position");
CREATE INDEX IF NOT EXISTS "place_menu_check_flags_item_idx" ON "place_menu_check_flags" ("item_id");

-- The restaurant's logo, as an external https image on its own site, and the page Scout found it on.
-- Rendered directly with no referrer, never fetched or proxied.
ALTER TABLE "places" ADD COLUMN "logo_url" text CHECK ("logo_url" IS NULL OR (length("logo_url") <= 500 AND "logo_url" LIKE 'https://%'));
ALTER TABLE "places" ADD COLUMN "logo_source_url" text CHECK ("logo_source_url" IS NULL OR (length("logo_source_url") <= 500 AND "logo_source_url" LIKE 'https://%'));
