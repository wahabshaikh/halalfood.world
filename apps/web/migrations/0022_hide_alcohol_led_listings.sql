-- Hide alcohol-led listings, using the listing_status flag from 0020.
-- Hidden rows stay in the table and keep all their data.
--
-- Rule, decided for launch: hide only rows with a real alcohol signal in the
-- Google Places data we store. A name containing bar is not a signal, so
-- Kebab Bar, Juice Bar and Bar and Grill style names stay listed.
--   serves_beer or serves_wine is true in places.google_place_payload, or
--   a Google primary type of bar, pub, night_club, brewery or wine_bar.
-- We store the legacy Place Details payload, which has serves_beer,
-- serves_wine and a types array but no primary type. So only the serves
-- flags can match today. The 4 rows whose types array includes bar also
-- have both serves flags set.
--
-- The ids below are every listed row that matched on 2026-10-04.
-- Each update re-checks the signal, so an id whose payload changed is left
-- alone. Rows with an approved or pending halal verification are skipped
-- for a human call. None existed when this file was written.
-- Running it twice changes nothing.
--
-- Matched rows, all in Mumbai:
--   64562d6b-92ef-41f9-8044-fdfc95f67928  Afzal Mao Restaurant
--   fab59e8b-db6f-49be-b7e1-471e5dc194ca  Bayroute Cuffe Parade
--   5818de0d-e91d-4c4e-9825-41b192c6c07d  Carters Blue
--   54930ffe-388c-44ab-9466-ab6461d40ddf  Delhi Zaika
--   f3077310-c0a0-46f3-b908-1ba539c1e141  Fifty Five East
--   597c3bb1-c342-4041-be9c-5c84eb93e675  Hornbys Pavilion
--   64a816e3-235e-4d51-bdc4-257ffb09ea1f  JYRAN - TANDOOR DINING & LOUNGE
--   12c58870-9929-45de-801e-e0c51ce0dfc7  Kebabs & Kurries
--   84bf95b4-78c3-4b13-b934-1690cadfde7e  Keibaa x All saints
--   5fdf3aa7-4b81-4b38-b9cb-1b05e09c1af6  Khyber
--   eb86ce20-7b72-428d-a104-366345b0b3d4  Pali Bhavan
--   4bebad60-3957-4ec0-93ca-f6b44178f92f  Peshwa Pavilion
--   e0ca5e62-f760-4ed5-b5e7-9ee939ef3af3  Rue Du Liban
--   3b1f3348-4d55-4077-a011-de964c2a315e  Sahib Room & Kipling Bar
--   1e28ae98-92d1-4e52-b6f7-801fada78b74  Shalimar Restaurant
--   64836b05-9902-4e97-a24a-559fb71ab925  Tanatan Shivaji Park
--   d419590b-0ed0-45c8-b852-c58053d8a2c8  The Earth Plate
--   bfaf3c15-e057-465a-ac49-b39727e553da  The Table
--   181052eb-fbb6-4f0e-a3db-2ddcf5a9cd5a  Tiqri
--   b5339d6d-9798-47e5-9257-b721c7edcf1f  Trishna
--   d471c0bd-4e23-4407-92e0-938501ce2cf8  YAZU - Pan Asian Supper Club Lower Parel
--
-- To undo, run this against the same database:
-- UPDATE places SET listing_status = 'listed'
-- WHERE listing_status = 'hidden' AND id IN (
--   '64562d6b-92ef-41f9-8044-fdfc95f67928',
--   'fab59e8b-db6f-49be-b7e1-471e5dc194ca',
--   '5818de0d-e91d-4c4e-9825-41b192c6c07d',
--   '54930ffe-388c-44ab-9466-ab6461d40ddf',
--   'f3077310-c0a0-46f3-b908-1ba539c1e141',
--   '597c3bb1-c342-4041-be9c-5c84eb93e675',
--   '64a816e3-235e-4d51-bdc4-257ffb09ea1f',
--   '12c58870-9929-45de-801e-e0c51ce0dfc7',
--   '84bf95b4-78c3-4b13-b934-1690cadfde7e',
--   '5fdf3aa7-4b81-4b38-b9cb-1b05e09c1af6',
--   'eb86ce20-7b72-428d-a104-366345b0b3d4',
--   '4bebad60-3957-4ec0-93ca-f6b44178f92f',
--   'e0ca5e62-f760-4ed5-b5e7-9ee939ef3af3',
--   '3b1f3348-4d55-4077-a011-de964c2a315e',
--   '1e28ae98-92d1-4e52-b6f7-801fada78b74',
--   '64836b05-9902-4e97-a24a-559fb71ab925',
--   'd419590b-0ed0-45c8-b852-c58053d8a2c8',
--   'bfaf3c15-e057-465a-ac49-b39727e553da',
--   '181052eb-fbb6-4f0e-a3db-2ddcf5a9cd5a',
--   'b5339d6d-9798-47e5-9257-b721c7edcf1f',
--   'd471c0bd-4e23-4407-92e0-938501ce2cf8'
-- )

UPDATE places
SET listing_status = 'hidden'
WHERE listing_status = 'listed'
  AND id IN (
      '64562d6b-92ef-41f9-8044-fdfc95f67928',
      'fab59e8b-db6f-49be-b7e1-471e5dc194ca',
      '5818de0d-e91d-4c4e-9825-41b192c6c07d',
      '54930ffe-388c-44ab-9466-ab6461d40ddf',
      'f3077310-c0a0-46f3-b908-1ba539c1e141',
      '597c3bb1-c342-4041-be9c-5c84eb93e675',
      '64a816e3-235e-4d51-bdc4-257ffb09ea1f',
      '12c58870-9929-45de-801e-e0c51ce0dfc7',
      '84bf95b4-78c3-4b13-b934-1690cadfde7e',
      '5fdf3aa7-4b81-4b38-b9cb-1b05e09c1af6',
      'eb86ce20-7b72-428d-a104-366345b0b3d4',
      '4bebad60-3957-4ec0-93ca-f6b44178f92f',
      'e0ca5e62-f760-4ed5-b5e7-9ee939ef3af3',
      '3b1f3348-4d55-4077-a011-de964c2a315e',
      '1e28ae98-92d1-4e52-b6f7-801fada78b74',
      '64836b05-9902-4e97-a24a-559fb71ab925',
      'd419590b-0ed0-45c8-b852-c58053d8a2c8',
      'bfaf3c15-e057-465a-ac49-b39727e553da',
      '181052eb-fbb6-4f0e-a3db-2ddcf5a9cd5a',
      'b5339d6d-9798-47e5-9257-b721c7edcf1f',
      'd471c0bd-4e23-4407-92e0-938501ce2cf8'
  )
  AND (
    IFNULL(google_place_payload, '') LIKE '%"serves_beer":true%'
    OR IFNULL(google_place_payload, '') LIKE '%"serves_wine":true%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM place_halal_verifications v
    WHERE v.place_id = places.id
      AND v.status IN ('approved', 'pending')
  );
