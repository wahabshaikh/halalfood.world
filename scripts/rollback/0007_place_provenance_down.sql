-- Rollback for migrations/0007_place_provenance.sql: undo its backfill. OPERATOR ONLY, never applied by a deploy.
-- docs/runbooks/unverified-imports.md#rollback
--
-- This file lives outside migrations/ on purpose: wrangler applies every migrations/*.sql, so a "down" file there
-- would run on the next deploy. Nothing here drops a column, because deployed code reads import_source and
-- import_verified_at; with both NULL every place is unlabelled, indexable and back in the sitemap. The columns and
-- places_indexable_idx stay (harmless); removing them would be a later, separate contract migration.
--
-- No BEGIN/COMMIT: D1 rejects explicit transactions. Safe to run twice.
--
-- Before running it against production, take a Time Travel bookmark (wrangler d1 time-travel info DB) and run
-- scripts/sql/unverified-counts-after.sql. Run it only with explicit approval:
--   pnpm exec wrangler d1 execute DB --remote --file=scripts/rollback/0007_place_provenance_down.sql
-- Code that keeps running after this re-verifies a place on its next check, evidence or Scout write only if it is
-- imported, so with import_source cleared nothing is labelled again. To relabel later, re-run 0007's two UPDATEs.

UPDATE "places" SET "import_source" = NULL, "import_verified_at" = NULL WHERE "import_source" = 'halalfoodnear.me';
