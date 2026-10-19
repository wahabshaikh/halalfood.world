-- Unverified imported places: counts AFTER migration 0007 (read only, SELECTs only).
-- docs/runbooks/unverified-imports.md
--
--   pnpm exec wrangler d1 execute DB --local --file=scripts/sql/unverified-counts-after.sql
--
-- indexable = in the sitemap and without noindex (lib/place-view.ts INDEXABLE):
--   listing_status = 'listed' AND (import_source IS NULL OR import_verified_at IS NOT NULL)
-- labelled = the "Unverified" label and noindex (lib/place-view.ts UNVERIFIED_SQL):
--   import_source IS NOT NULL AND import_verified_at IS NULL
SELECT
  (SELECT count(*) FROM places) AS total_places,
  (SELECT count(*) FROM places WHERE listing_status = 'listed') AS listed_places,
  (SELECT count(*) FROM places WHERE listing_status = 'listed' AND (import_source IS NULL OR import_verified_at IS NOT NULL)) AS indexable,
  (SELECT count(*) FROM places WHERE import_source IS NOT NULL) AS imported,
  (SELECT count(*) FROM places WHERE import_source IS NOT NULL AND import_verified_at IS NULL) AS labelled_unverified,
  (SELECT count(*) FROM places WHERE listing_status = 'listed' AND import_source IS NOT NULL AND import_verified_at IS NULL) AS labelled_unverified_listed,
  (SELECT count(*) FROM places WHERE import_source IS NOT NULL AND import_verified_at IS NOT NULL) AS imported_but_verified,
  -- The predicate still matches every imported row, and nothing else is imported: expected equal to imported.
  (SELECT count(*) FROM places WHERE created_at = 1789282699475 AND submitted_by_user_id IS NULL) AS import_predicate_matches,
  (SELECT count(*) FROM places WHERE import_source IS NOT NULL AND (created_at <> 1789282699475 OR submitted_by_user_id IS NOT NULL)) AS imported_outside_predicate;
