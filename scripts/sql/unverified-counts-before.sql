-- Unverified imported places: counts on the schema BEFORE migration 0007 (read only, SELECTs only).
-- docs/runbooks/unverified-imports.md
--
--   pnpm exec wrangler d1 execute DB --local --file=scripts/sql/unverified-counts-before.sql
--
-- Before 0007 nothing is labelled, and the sitemap (lib/places.ts listPlaceRefs) lists every place with
-- listing_status = 'listed'. "flagged" uses 0007's predicate for the halalfoodnear.me import:
--   created_at = 1789282699475 AND submitted_by_user_id IS NULL
-- "with_evidence" is the existence rule (lib/core/provenance.ts seenToExist), written in SQL the same way as 0007:
-- a counted check (not excluded, author not suspended, account a day old when they checked), an approved
-- certificate or menu, a creator video verification, or a Scout certified = yes claim with a source URL.
WITH flagged AS (
  SELECT p.id, p.listing_status,
    (
      EXISTS (
        SELECT 1 FROM checks c JOIN "user" u ON u.id = c.user_id LEFT JOIN profiles pr ON pr.user_id = c.user_id
        WHERE c.place_id = p.id AND c.excluded = 0 AND pr.suspended_at IS NULL AND c.created_at - u.created_at >= 86400000
      )
      OR EXISTS (SELECT 1 FROM place_signals g WHERE g.place_id = p.id AND g.source IN ('certificate', 'menu') AND g.review_status = 'approved')
      OR EXISTS (SELECT 1 FROM creator_verifications v WHERE v.place_id = p.id)
      OR EXISTS (
        SELECT 1 FROM place_claims k WHERE k.place_id = p.id AND k.source = 'scout' AND k.fact = 'certified' AND k.value = 'yes'
          AND k.source_url IS NOT NULL AND k.source_url <> ''
      )
    ) AS with_evidence
  FROM places p
  WHERE p.created_at = 1789282699475 AND p.submitted_by_user_id IS NULL
)
SELECT
  (SELECT count(*) FROM places) AS total_places,
  (SELECT count(*) FROM places WHERE listing_status = 'listed') AS listed_places,
  -- The sitemap today: every listed place.
  (SELECT count(*) FROM places WHERE listing_status = 'listed') AS indexable_now,
  0 AS labelled_unverified_now,
  (SELECT count(*) FROM flagged) AS would_be_flagged,
  (SELECT count(*) FROM flagged WHERE listing_status = 'listed') AS would_be_flagged_listed,
  (SELECT count(*) FROM flagged WHERE listing_status <> 'listed') AS would_be_flagged_hidden_or_closed,
  -- Flagged rows 0007 marks verified straight away.
  (SELECT count(*) FROM flagged WHERE with_evidence) AS would_be_flagged_with_evidence,
  (SELECT count(*) FROM flagged WHERE listing_status = 'listed' AND NOT with_evidence) AS would_be_labelled_unverified,
  (SELECT count(*) FROM places WHERE listing_status = 'listed')
    - (SELECT count(*) FROM flagged WHERE listing_status = 'listed' AND NOT with_evidence) AS indexable_after_0007_projected,
  -- Rows 1 ms either side of the import timestamp: expected 0.
  (SELECT count(*) FROM places WHERE created_at IN (1789282699474, 1789282699476) AND submitted_by_user_id IS NULL) AS one_ms_either_side;
