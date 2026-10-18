-- Read-only candidate report, not proof of a bad pin or of Scout creation.
-- No submitter alone is never provenance. Shared buildings can have real duplicates.
WITH pinned AS (
  SELECT p.*, count(*) OVER (PARTITION BY city_slug, lat, lng) AS same_pin_count
  FROM places p
  WHERE submitted_by_user_id IS NULL AND lat IS NOT NULL AND lng IS NOT NULL
), candidates AS (
  SELECT * FROM pinned
  WHERE same_pin_count > 1
    OR trim(lower(street_address)) = trim(lower(coalesce(address_locality, replace(city_slug, '-', ' '))))
    OR street_address NOT GLOB '*[0-9]*'
)
SELECT p.id, p.name, p.city_slug, p.street_address, p.lat, p.lng, p.created_at,
  p.location_source, p.google_place_id, p.same_pin_count,
  EXISTS (
    SELECT 1 FROM audit_log a
    WHERE a.actor_user_id = 'mcp:scout' AND a.action = 'listing.changed'
      AND a.target_type = 'listing' AND a.target_id = 'directory'
      AND json_valid(a.after_value)
      AND json_extract(a.after_value, '$.change') = 'place-added'
      AND json_extract(a.after_value, '$.placeId') = p.id
  ) AS scout_creation_audit
FROM candidates p
ORDER BY p.city_slug, p.lat, p.lng, p.name;
