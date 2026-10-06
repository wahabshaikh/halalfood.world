# Operations

Scripts that touch remote data. Each one reads credentials from your shell and is run by a person, never by CI
or an agent without being asked. Local equivalents need nothing.

## Google Places

`GOOGLE_PLACES_API_KEY` is preferred; `GOOGLE_MAPS_API_KEY` is accepted as a
fallback for existing deployments. Both are server-only secrets: never prefix
them with `NEXT_PUBLIC_`, expose them to the browser, or commit their values.
The Places client uses the Places API (New) Place Details endpoint and explicit
field masks. The default mask stays on Essentials fields (`id`, `name`,
`formattedAddress`, `location`, `photos`); requests that only need coordinates
use `location` alone. An explicit useful-fields mask is available for the
restaurant display name, address, phone, regular hours and photo fields when a
caller accepts the higher Pro/Enterprise SKU exposure.

See Google’s [Place Details (New) field-mask guide](https://developers.google.com/maps/documentation/places/web-service/place-details)
and [current Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
before enabling broader fields.

Google Places requests are optional. A missing key, provider error or malformed
response leaves the database-backed page unchanged, so a page can still render
without Google. The add flow uses a small, explicit mask (`id`, `displayName`,
`formattedAddress`, `location`) for Details and a similarly small mask for Text
Search. `displayName` is the one necessary human-readable name field and is
classified by Google as Pro; no contact, hours, rating, review or photo fields
are requested. Confirm the current Google Maps Platform terms and billing
account before scaling.

## Halal listing import

Map listings are one of the halal signals (see
[`docs/product/halal-model.md`](docs/product/halal-model.md)). This script
reads OpenStreetMap's `diet:halal` tag through Overpass around each city's
listed places, plus Geoapify's halal places when `GEOAPIFY_API_KEY` is set,
matches them to places by name within 80 m, and recomputes the matched places.
It uses the same D1 REST environment as the backfill below.

```sh
pnpm signals:listings --city london --dry-run
pnpm signals:listings --city london
```

Set `OVERPASS_URL` to use a different Overpass instance. Listings never settle
a fact or verify a place on their own; a "halal only" listing fills in "No pork"
only until a check or a menu says otherwise.

## Google Places coordinate backfill

The server-side client is in `lib/google-places.ts` and calls Place
Details (New) with `GET https://places.googleapis.com/v1/places/{placeId}`.
The add form also uses the Places (New) Text Search endpoint, caps the result
list at five, and requests only display names, addresses, coordinates and
opaque place IDs. On submit, the server fetches Place Details again and
persists the returned name, formatted address, coordinates and place ID. The
Google API key never reaches the browser. Search is optional: when no key is
configured, the same form supports manual entry.
`app/place/[id]/page.tsx` uses persisted coordinates first. Its page-level
Essentials snapshot also supplies coordinates when the row is missing one, so
the render does not make a second location-only request. The existing
`enrichPlaceCoordinates` helper remains available for the operational
backfill, and Google failures still leave the page unchanged.

Ops can backfill without browser scraping using the CLI. The D1 binding only
exists inside the Worker, so this script talks to the remote database through
Cloudflare's D1 REST API (`scripts/d1-rest-client.ts`) instead of `lib/db`. It
reads `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`,
`CLOUDFLARE_API_TOKEN`, and `GOOGLE_PLACES_API_KEY` (or the Maps fallback)
from the environment, processes requests sequentially, and sleeps between
calls:

```sh
export CLOUDFLARE_ACCOUNT_ID=<your Cloudflare account id>
export CLOUDFLARE_D1_DATABASE_ID=<the halalfood-world D1 database id>
export CLOUDFLARE_API_TOKEN=<a token with D1 edit permission>
export GOOGLE_PLACES_API_KEY=<your Google Places API key>

# Fetch and report proposed updates, but do not write rows.
pnpm backfill:places --dry-run --limit 50 --batch-size 10 --delay-ms 300

# Apply at most 500 updates.
pnpm backfill:places --limit 500 --batch-size 25 --delay-ms 300
```

The safe initial heuristic selects only rows with a `google_place_id` and a
null `lat` or `lng`; updates recheck that predicate and the place ID, so an
existing coordinate is never overwritten. This intentionally leaves the
current non-null centroid-plus-jitter coordinates alone until their provenance
can be distinguished from verified coordinates. `--dry-run` still calls
Google to show the proposed coordinates and therefore still consumes requests.
Keep `--delay-ms` and `--limit` within the project's quota; lower batch sizes
and longer delays are appropriate if Google returns quota errors. The script
reports provider failures and exits non-zero when any candidate fails.

## Carrying places across a database reset

For a local or preview database only, place listings can be carried across a reset like this. Production never takes this path; the Oct 5 cutover imported old prod's places into the new database as reviewed SQL instead:

```sh
pnpm places:export seed/places.jsonl   # before
pnpm db:migrate:remote                                      # baseline
pnpm places:import seed/places.jsonl   # after
```

Only listed rows and the columns the new schema keeps are carried. Every place comes back as "Not checked yet".

```sh
pnpm db:migrate:local  # local development database
pnpm db:migrate:remote # deployed production D1 database (halalfood-world-v2)
```

## Email healthcheck

The optional email smoke check is disabled unless `EMAIL_HEALTHCHECK_ENABLED=true`. To enable it, configure `EMAIL_HEALTHCHECK_TO` and store a long random bearer token as `EMAIL_HEALTHCHECK_TOKEN` (`pnpm exec wrangler secret put EMAIL_HEALTHCHECK_TOKEN`), then send an authenticated `POST` to `/api/admin/email/healthcheck` with `Authorization: Bearer <token>`. The endpoint has no request-supplied recipient and returns 404 while disabled, so it cannot be used as an unauthenticated spam endpoint. Use it only for occasional operator checks; it is not a queue or mass-mailing mechanism.

## Brand assets

`public/` holds an SVG favicon, PNG icons (32, 180, 512) and the 1200x630 Open Graph image, plus `site.webmanifest`. The PNGs are drawn from primitives by `scripts/generate-assets.mjs` and committed, so the build needs no image toolchain and the repo carries no design exports:

```sh
node scripts/generate-assets.mjs
```

Brand PNGs in `public/` are rendered from `public/icon.svg` with `node scripts/generate-assets.mjs` (set `PLAYWRIGHT_CHROMIUM_PATH` if Chromium isn't in Playwright's default location).
