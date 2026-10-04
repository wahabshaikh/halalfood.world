-- Reversible public-listing flag. Hidden rows stay in the table.
-- listed is the public default. Set a row back to listed to undo a hide.
-- Keep comments free of quote characters. The remote runner does not skip them.
--
-- Hide rules, applied once to rows that exist when this file runs:
-- beer hall, beer garden, beer club, brewery, brewpub, brauhaus, hofbrau,
-- wine bar, cu bere, a pub or tavern as its own word.
-- Taverna is not a tavern. Bar and grill is hidden only with a Google type
-- that agrees, plus one id named in the launch audit.
-- Also fills the missing pin for Slam Burger Luton at 180 Dunstable Rd,
-- and clears the cuisine label Halal, which is not a cuisine.

ALTER TABLE places ADD COLUMN listing_status TEXT NOT NULL DEFAULT 'listed';

UPDATE places
SET listing_status = 'hidden'
WHERE listing_status = 'listed'
  AND (
    id IN (
      '9b7e3268-acd8-446a-8276-0059c5ca160b',
      '8ec28ef0-c0e4-4201-be28-560d73aad055',
      'd3d78795-a871-4515-9190-012b9191f11c',
      '58ce6e17-6bbd-4a88-85b0-996fa5122017',
      '94c866ef-f8a8-4a26-a37f-a1a2a89aa6c7',
      'bf789cd0-3c26-416f-9099-044a6817211b',
      '7763fcb3-d578-4cae-a4a4-947cf771113b',
      'eacd45ac-ed03-4840-9229-a9e939b645f4',
      '65992004-f61e-42b3-b4ea-2b7f9e8908ef',
      'be63903f-1a4e-4460-8dc4-e2a5aa13b509'
    )
    OR lower(name) LIKE '%beer hall%'
    OR lower(name) LIKE '%beer garden%'
    OR lower(name) LIKE '%beer club%'
    OR lower(name) LIKE '%beer house%'
    OR lower(name) LIKE '%beerhouse%'
    OR lower(name) LIKE '%& beer%'
    OR lower(name) LIKE '% and beer%'
    OR lower(name) LIKE '%brewery%'
    OR lower(name) LIKE '%brewpub%'
    OR lower(name) LIKE '%brew pub%'
    OR lower(name) LIKE '%brauhaus%'
    OR lower(name) LIKE '%bräuhaus%'
    OR lower(name) LIKE '%hofbr%'
    OR lower(name) LIKE '%wine bar%'
    OR lower(name) LIKE '%cu bere%'
    OR (lower(name) LIKE '%tavern%' AND lower(name) NOT LIKE '%taverna%')
    OR (' ' || lower(name) || ' ') LIKE '% pub %'
    OR lower(name) LIKE '%pub &%'
    OR lower(name) LIKE '%pub and %'
    OR IFNULL(google_place_payload, '') LIKE '%"brewery"%'
    OR IFNULL(google_place_payload, '') LIKE '%"wine_bar"%'
    OR IFNULL(google_place_payload, '') LIKE '%"pub"%'
    OR IFNULL(google_details_snapshot, '') LIKE '%"brewery"%'
    OR IFNULL(google_details_snapshot, '') LIKE '%"wine_bar"%'
    OR IFNULL(google_details_snapshot, '') LIKE '%"pub"%'
    OR (
      (
        lower(name) LIKE '%bar and grill%'
        OR lower(name) LIKE '%bar & grill%'
        OR lower(name) LIKE '%bar&grill%'
      )
      AND (
        IFNULL(google_place_payload, '') LIKE '%"bar"%'
        OR IFNULL(google_details_snapshot, '') LIKE '%"bar"%'
        OR IFNULL(google_place_payload, '') LIKE '%"brewery"%'
        OR IFNULL(google_place_payload, '') LIKE '%"wine_bar"%'
        OR IFNULL(google_place_payload, '') LIKE '%"pub"%'
      )
    )
  );

UPDATE places
SET lat = 51.8868333, lng = -0.4312885
WHERE id = '081ea610-a74f-4990-b8ca-3216aac6dfc8'
  AND lat IS NULL
  AND lng IS NULL
  AND street_address = '180 Dunstable Rd';

UPDATE places
SET serves_cuisine = '[]'
WHERE serves_cuisine = '["Halal"]';
