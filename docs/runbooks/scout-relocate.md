# Repair Scout city-centre pins

City-only inputs formerly passed geocode confidence when Google's address named the city.
Existing coordinates then prevented re-geocoding. New writes reject those inputs before any
Google request and reject area-level or untyped Google results. Failed geocodes leave new or
unlocated places pending; they do not erase an existing pin.

## Find candidates (read only)

[`scripts/scout-city-pins.sql`](../../scripts/scout-city-pins.sql) reports duplicate exact pins
within a city among no-submitter places, addresses equal to the city, and addresses with no digits.
It includes id, name, city_slug, street_address, lat, lng, created_at, source, Google id,
shared-pin count and whether a Scout creation audit exists. It is deliberately broader than the
pure street-address heuristic: SQLite has no equivalent built-in Unicode/regex normalizer.
Numberless streets and shared buildings are false positives; unique city pins with postcodes can
be missed. Review the address and venue before repairing. No submitter is not proof of Scout origin.

Run locally:

```sh
pnpm exec wrangler d1 execute DB --local --file=scripts/scout-city-pins.sql
```

A human operator can run this SELECT against production using the approved read-only database
workflow. This change has not inspected production or identified the reported 22 rows remotely.
The SQL file is the canonical query; no corrective SQL is included or required.

## Re-send confirmed locations

Use the candidate's `id` as `place_id` and send the confirmed street address with `relocate: true`.
This avoids creating a duplicate when correcting the address prevents name/street matching.
`place_id` must be an existing UUID, requires `relocate: true`, and excludes `force_new`.
Omitting it preserves normal Google-id/name/address/distance matching.

```json
{
  "name": "Example Cafe",
  "place_id": "12345678-1234-1234-1234-123456789abc",
  "address": "7 Boundary St, London E2 7JE",
  "city": "London",
  "country": "United Kingdom",
  "relocate": true
}
```

Call `upsert_place` with this object, or put objects in `upsert_places.places` (up to 25).
Send `lat` and `lng` together instead if independently confirmed. Street-only input uses Google
and the existing daily caps. `relocate` never bypasses geocode confidence or authorizes a guess.
Existing coordinates return `location: "relocated"` with `previous` and `current`, each
`{lat, lng, source}`. Filling missing coordinates still returns `provided` or `geocoded`.
Verify the returned id, coordinates and address. The city slug and permanent URL stay unchanged.

Partial protected coordinate pairs are also preserved; only a wholly absent pair can be filled without provenance.
Sources `community`, `google`, `import` and `listing` are protected, even with `relocate`.
Unknown (`NULL`) sources are also protected unless **explicit relocation** finds a matching
`audit_log` entry: actor `mcp:scout`, action `listing.changed`, target `listing/directory`, JSON
`change = place-added` and `placeId = id`, with no submitter on the place. Scout's creation path
wrote that entry in the 0004/0005 era; claims and creator verifications can be added to arbitrary
places and do not prove creation. A missing creation audit (including a failed cache publication)
means the legacy pin stays protected: escalate for human review; do not spoof an audit or source.
A refusal returns `existing` and `relocate_refused`, for example `protected_source`.

Migration `0006_place_location_source.sql` adds one nullable text column and backfills nothing.
All existing rows remain unknown; creation provenance does not establish coordinate provenance.
New Scout explicit coordinates use `scout`; Scout geocoding uses `geocoded`; Google add-a-place
uses `google`; seed imports and coordinate backfills use `import`. Community/owner/moderator
edits currently do not change coordinates, and listing-signal imports only write evidence, so
`community` and `listing` are reserved valid sources for future coordinate writers.
