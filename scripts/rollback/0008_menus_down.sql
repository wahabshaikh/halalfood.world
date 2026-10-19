-- Rollback for migrations/0008_menus.sql. NOT a migration: wrangler only applies migrations/*.sql, so this folder is
-- never picked up by `d1 migrations apply`. Run it by hand, and only before or together with reverting the code that
-- reads these tables and columns (lib/menus.ts, lib/scout/menus.ts, lib/place-view.ts): a deployed Worker that still
-- reads them fails once they are gone. Take a Time Travel bookmark first (docs/deployment.md).
--
-- It drops only what 0008 added. Scout claims a flagged menu check wrote live in place_claims (0005) and stay.
-- Afterwards, delete 0008's row from d1_migrations so the migration can be applied again:
--   DELETE FROM d1_migrations WHERE name = '0008_menus.sql';

DROP INDEX IF EXISTS "place_menu_check_flags_item_idx";
DROP INDEX IF EXISTS "place_menu_check_flags_place_idx";
DROP TABLE IF EXISTS "place_menu_check_flags";
DROP TABLE IF EXISTS "place_menu_checks";
DROP INDEX IF EXISTS "place_menu_sources_place_idx";
DROP TABLE IF EXISTS "place_menu_sources";
DROP INDEX IF EXISTS "place_menu_items_place_idx";
DROP TABLE IF EXISTS "place_menu_items";
DROP TABLE IF EXISTS "place_menus";
-- SQLite 3.35+ (D1) drops columns; neither column is indexed or referenced, which DROP COLUMN requires.
ALTER TABLE "places" DROP COLUMN "logo_source_url";
ALTER TABLE "places" DROP COLUMN "logo_url";
