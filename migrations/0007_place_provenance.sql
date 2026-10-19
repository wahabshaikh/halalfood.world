-- Listing provenance for imported places, and whether each has been seen and verified to exist. Additive only:
-- two nullable columns, one partial index, and idempotent UPDATEs. docs/runbooks/unverified-imports.md.
--
-- No BEGIN/COMMIT here: D1 rejects explicit transactions, and wrangler already runs each migration file as one unit.
--
-- About 7.7k places scraped from halalfoodnear.me on 13 Sep 2026 were carried into production at the Oct 5 cutover,
-- without their scrape columns (source, source_url, scraped_at). They are labelled "Unverified" and kept out of
-- search engines until something shows they exist (lib/core/provenance.ts, docs/spec/halal-model.md#provenance).
-- This is not a halal status: it never feeds lib/core/halal.ts or place_status.
--
--   import_source        where an imported place came from: 'halalfoodnear.me', or NULL for every place people,
--                        moderators or Halal Food Scout added. Set once here; nothing writes it afterwards.
--   import_verified_at   epoch ms when an imported place was first found verified, or NULL while it is not.
--                        The app recomputes it on every check, evidence, claim, creator verification and merge
--                        write (lib/provenance.ts), so it goes back to NULL when the last evidence is removed.
--
-- Labelled and noindexed:  import_source IS NOT NULL AND import_verified_at IS NULL

ALTER TABLE "places" ADD COLUMN "import_source" text;
ALTER TABLE "places" ADD COLUMN "import_verified_at" integer;

-- The sitemap's scan: listed places that are not unverified imports, in id order (lib/place-view.ts INDEXABLE).
CREATE INDEX IF NOT EXISTS "places_indexable_idx" ON "places" ("id")
  WHERE "listing_status" = 'listed' AND ("import_source" IS NULL OR "import_verified_at" IS NOT NULL);

-- Backfill provenance. Every scraped row shares the bulk insert's exact millisecond (2026-09-13T06:58:19.475Z) and has
-- no submitter; the one other carried row (Slam Burger Luton) and every place created since have their own
-- created_at. Safe to re-run: rows already marked are skipped.
UPDATE "places" SET "import_source" = 'halalfoodnear.me'
WHERE "created_at" = 1789282699475 AND "submitted_by_user_id" IS NULL AND "import_source" IS NULL;

-- Mark the imported places that already have evidence they exist as verified now (lib/core/provenance.ts seenToExist):
--   a check that counts (not excluded, author not suspended, account a day old when they checked: isEligible),
--   an approved certificate or menu (map listings don't count),
--   a Halal Food Scout creator video verification,
--   a Scout claim that it is halal certified, with its source URL.
-- Safe to re-run: rows already verified are skipped.
UPDATE "places" SET "import_verified_at" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE "import_source" IS NOT NULL AND "import_verified_at" IS NULL AND (
  EXISTS (
    SELECT 1 FROM "checks" c JOIN "user" u ON u."id" = c."user_id" LEFT JOIN "profiles" pr ON pr."user_id" = c."user_id"
    WHERE c."place_id" = "places"."id" AND c."excluded" = 0 AND pr."suspended_at" IS NULL
      AND c."created_at" - u."created_at" >= 86400000
  )
  OR EXISTS (
    SELECT 1 FROM "place_signals" g
    WHERE g."place_id" = "places"."id" AND g."source" IN ('certificate', 'menu') AND g."review_status" = 'approved'
  )
  OR EXISTS (SELECT 1 FROM "creator_verifications" v WHERE v."place_id" = "places"."id")
  OR EXISTS (
    SELECT 1 FROM "place_claims" k
    WHERE k."place_id" = "places"."id" AND k."source" = 'scout' AND k."fact" = 'certified' AND k."value" = 'yes'
      AND k."source_url" IS NOT NULL AND k."source_url" <> ''
  )
);
