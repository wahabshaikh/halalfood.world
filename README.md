# halalfood.world

A full-screen halal food map built with vinext, React, MapLibre GL, Drizzle and the Neon serverless HTTP driver, deployed as a Cloudflare Worker. The interface uses CARTO Positron with OpenStreetMap attribution.

The map is the product; server-rendered city and place pages sit underneath it so the listings are crawlable, linkable and shareable without JavaScript.

## Local setup

Use Node 22:

```sh
export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.local/share/fnm:$PATH"
node --version
npm ci
```

Create a **gitignored** `.dev.vars` in the repo root containing the local-only database and email settings below. Do not put secrets in client variables or commit this file. The Cloudflare Vite plugin loads it; the Worker reads bindings through `process.env.*` with Node compatibility enabled.

```dotenv
DATABASE_URL=<your Neon connection string>
RESEND_API_KEY=<your Resend API key>
EMAIL_FROM=noreply@halalfood.world
BETTER_AUTH_SECRET=<long random Better Auth secret>
BETTER_AUTH_URL=http://localhost:3000
TURNSTILE_SITE_KEY=<public Cloudflare Turnstile site key>
TURNSTILE_SECRET_KEY=<Cloudflare Turnstile server secret>
GOOGLE_PLACES_API_KEY=<your Google Places API key>
# GOOGLE_MAPS_API_KEY=<fallback Google Maps API key>
```

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

Email delivery uses the Workers-compatible Resend REST API. `noreply@halalfood.world` is the preferred sender after the domain is verified in Resend. Until then, set `EMAIL_FROM=onboarding@resend.dev` in the relevant environment. `RESEND_API_KEY` is required only when sending mail; the email helper has no bulk-send behavior and is intended for low-volume transactional messages. OTP delivery is additionally guarded by the durable limits described below.

```sh
npm run dev
npm run typecheck
npm test
# With the dev server running in another terminal:
npm run test:api
npx playwright install chromium
npm run test:browser
npm run build
npm start
```

Use the URL printed by the dev server. Development and production API requests run against the existing Neon `neondb`; map/listing reads remain bounded, while Better Auth, saved-place, and rate-limit writes use the migrations below.

## Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | Client map + SSR `WebSite`/`FAQPage` JSON-LD | The map. Accepts the deep links below. |
| `/cities` | SSR | Directory of every city, largest first. |
| `/city/[citySlug]` | SSR | Listings for one city, 60 per page, with `ItemList` + `BreadcrumbList` JSON-LD. |
| `/place/[id]` | SSR | One place, with `Restaurant` + `BreadcrumbList` JSON-LD. |
| `/saved` | Client list + SSR chrome | Authenticated user's saved halal places; unauthenticated visitors get a sign-in CTA. |
| `/add` | Client form + SSR chrome | Authenticated users can submit a halal place using Google Places or manual entry. |
| `/login` | Client form + SSR chrome | Email OTP sign-in protected by Cloudflare Turnstile. |
| `/robots.txt`, `/sitemap.xml` | Metadata routes | See below. |
| `/api/places`, `/api/places/search` | JSON | Viewport and search queries. |
| `/api/places/[id]`, `/api/cities/[citySlug]` | JSON | Lookups behind the map deep links. |
| `POST /api/places` | JSON | Authenticated halal place submission. |
| `GET /api/places/saved` | JSON | Authenticated list of the current user's saved places. |
| `POST/DELETE /api/places/[id]/saved` | JSON | Authenticated, rate-limited save or unsave mutation for one halal place. |
| `GET /api/places/google-search` | JSON | Authenticated, rate-limited Google Places (New) Text Search for the add form. |
| `/api/auth/*` | Better Auth catch-all | Email OTP request, verification, session, and sign-out endpoints. |
| `POST /api/admin/email/healthcheck` | JSON | Optional operator smoke check; disabled by default and bearer-token gated when enabled. |

## Google Places coordinate backfill

The server-side client is in `src/lib/google-places.ts` and calls Place
Details (New) with `GET https://places.googleapis.com/v1/places/{placeId}`.
The add form also uses the Places (New) Text Search endpoint, caps the result
list at five, and requests only display names, addresses, coordinates and
opaque place IDs. On submit, the server fetches Place Details again and
persists the returned name, formatted address, coordinates and place ID. The
Google API key never reaches the browser. Search is optional: when no key is
configured, the same form supports manual entry.
`app/place/[id]/page.tsx` uses persisted coordinates first; when either
coordinate is missing and `google_place_id` exists, it makes one location-only
request and still renders the page unchanged if Google is unavailable.

Ops can backfill without browser scraping using the CLI. It reads
`DATABASE_URL` and `GOOGLE_PLACES_API_KEY` (or the Maps fallback) from the
environment, processes requests sequentially, and sleeps between calls:

```sh
export DATABASE_URL=<your Neon connection string>
export GOOGLE_PLACES_API_KEY=<your Google Places API key>

# Fetch and report proposed updates, but do not write rows.
npm run backfill:places -- --dry-run --limit 50 --batch-size 10 --delay-ms 300

# Apply at most 500 updates.
npm run backfill:places -- --limit 500 --batch-size 25 --delay-ms 300
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

## Email OTP auth

The `/login` page renders a Cloudflare Turnstile widget, then uses the Better Auth `emailOTP` plugin to request and verify a 6-digit sign-in code. The client uses `emailOTPClient`; successful verification creates a database-backed Better Auth session and secure, HTTP-only cookie. OTP mail is sent only through `src/lib/email.ts`, uses `EMAIL_FROM` when set, and includes both text and HTML bodies.

Turnstile is fail closed: the request endpoint returns an error when either `TURNSTILE_SITE_KEY` or `TURNSTILE_SECRET_KEY` is missing, when no token is supplied, or when Cloudflare rejects the token. The site key is intentionally rendered to the browser and is not a secret. `TURNSTILE_SECRET_KEY`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, and `DATABASE_URL` must never be client-exposed or committed.

Rate limits use Neon/Postgres, not KV (this Worker has no KV binding). Better Auth's database-backed IP/endpoint limiter uses the `rate_limit` table. The auth route also uses the `auth_otp_rate_limit` table with SHA-256 hashed email/IP keys and a Neon HTTP transaction with advisory locks:

- OTP requests: one email can send at most 5 codes per 24 hours with a 60-second cooldown; one IP can send at most 30 per 24 hours with a 10-second cooldown.
- OTP verification: at most 5 attempts per email and 20 per IP per 15 minutes. The budget is consumed before checking a submitted code, so concurrent guesses cannot bypass it. Better Auth also invalidates an OTP after 3 wrong attempts, and codes expire after 5 minutes.

Place submissions reuse the same Neon table and atomic advisory-lock pattern,
with separate hashed key namespaces: one signed-in user may submit at most 5
places per 24 hours with a 60-second cooldown, and one IP may submit at most 30
per 24 hours with a 10-second cooldown. Authenticated Google Text Search is
also capped at 30 requests per user per hour (1-second cooldown) and 120 per IP
per hour (250ms cooldown), keeping the optional paid lookup bounded.

Save and unsave mutations reuse the same durable table with their own hashed
key namespace: one user may perform at most 120 save actions per hour with a
250ms cooldown, and one IP may perform at most 300 per hour with a 100ms
cooldown. Both the user and IP bucket must allow the mutation.

The limiter fails closed if Neon is unavailable, so a provider outage cannot turn the endpoint into an unrestricted Resend sender. Old limiter rows can be pruned by Ops after confirming the retention policy; they contain hashes rather than raw identifiers.

### Auth schema migration

Apply [`migrations/0001_better_auth_email_otp.sql`](migrations/0001_better_auth_email_otp.sql) to the existing Neon database before deploying the auth route. It creates Better Auth's `user`, `session`, `account`, `verification`, and `rate_limit` tables plus the application OTP limiter table; it does not create a second database or alter `places`.

Apply [`migrations/0002_user_submitted_places.sql`](migrations/0002_user_submitted_places.sql) after it. It adds `places.submitted_by_user_id` and `places.halal_confirmed`, plus durable uniqueness for `(city_slug, name, street_address)` and non-null `google_place_id` values. The migration is additive and safe to re-run. New rows use `source = user-submitted`, `serves_cuisine = {Halal}`, the authenticated user id, and the submission time for both `created_at` and `scraped_at`.

Apply [`migrations/0003_saved_places.sql`](migrations/0003_saved_places.sql) after it. It creates the additive `saved_places` table with a cascading foreign key to Better Auth's `user`, a cascading foreign key to `places`, and a unique `(user_id, place_id)` pair. It is safe to re-run.

With `DATABASE_URL` already present in the shell, use either the Neon SQL Editor or:

```sh
psql "$DATABASE_URL" -f migrations/0001_better_auth_email_otp.sql
psql "$DATABASE_URL" -f migrations/0002_user_submitted_places.sql
psql "$DATABASE_URL" -f migrations/0003_saved_places.sql
```

The Drizzle definitions in `src/db/schema.ts` must stay aligned with this SQL. If Better Auth is upgraded or plugins are added, regenerate/review the Drizzle schema with the Better Auth CLI and create a new migration rather than changing the existing table names silently.

The add API is auth-gated with an authoritative Better Auth session lookup. A
manual submission stores the supplied name, address and city without making a
paid provider request; a Google submission re-fetches the minimal Place Details
mask on the server before writing. Every submission must include an explicit halal
confirmation. The place page labels these rows as community submissions, and
does not expose the submitter's id.

Dynamic segments are validated before they reach SQL: `citySlugParam` accepts only lowercase kebab-case, `placeIdParam` only UUIDs, and `pageParam` clamps the page index. An unparseable segment is a 404 and never costs a query.

City and place pages distinguish a missing row (a real 404) from an unreachable database (a `noindex, follow` "temporarily unavailable" page). A transient outage must never be indexed as if it were the page's content.

### Deep links and sharing

- `/?place=<uuid>` opens the map on that pin and its popup.
- `/?city=<slug>` frames the city on the map.
- `/?lat=<lat>&lng=<lng>&z=<zoom>` sets the initial view; invalid values fall back to the default view.
- Selecting a pin rewrites the address bar to `/?place=<uuid>` with `replaceState`, so the browser's own share button works.
- Popups, city pages and place pages carry a Share control: Web Share where available, clipboard otherwise, and a selectable URL if both are blocked. Shared links point at the canonical `/place/<id>` page, which previews with an OG image and links back to the map.

## SEO, AEO and GEO

- Root `metadata` in `app/layout.tsx` sets `metadataBase`, a title template, canonical, Open Graph, Twitter, robots, icons and the manifest. City and place pages override title, description, canonical and Open Graph per route.
- Paginated city views (`?page=2`) canonicalise to page one so ranking signals stay on a single URL.
- JSON-LD marks coordinates with `additionalProperty: locationPrecision = approximate`, and carries the same disclaimer the UI shows. Do not remove it: the coordinates are city centroids plus jitter, and structured data that implies otherwise would be misleading.
- `src/lib/seo.ts` holds the pure title/description/JSON-LD helpers and is unit-tested in `tests/seo.test.ts`.

### Sitemap strategy

`/sitemap.xml` is a **sitemap index**, not a urlset. ~12k places and a few hundred cities would fit in one file, but that would mean one large query per crawl and a full re-fetch whenever any row changes. The index points at:

| Child | Contents |
| --- | --- |
| `/sitemaps/core/sitemap.xml` | Home and the city directory. |
| `/sitemaps/cities/sitemap.xml` | One entry per distinct `city_slug`, capped at 2,000. |
| `/sitemaps/places/sitemap/N.xml` | Places, 5,000 per file (3 files today), from an id-ordered scan so chunk boundaries stay stable. |

`MAX_PLACE_CHUNKS` in `src/lib/sitemap.ts` caps the index at 50 chunks if the table ever grows far beyond its current size. If the count query fails, the index still advertises the core and city sitemaps rather than returning nothing.

## Brand assets

`public/` holds an SVG favicon, PNG icons (32, 180, 512) and the 1200x630 Open Graph image, plus `site.webmanifest`. The PNGs are drawn from primitives by `scripts/generate-assets.mjs` and committed, so the build needs no image toolchain and the repo carries no design exports:

```sh
node scripts/generate-assets.mjs
```

## Data and bounded APIs

- `GET /api/places?bbox=west,south,east,north&limit=600`: requires a valid bbox, defaults to 400 and caps at 600. West greater than east crosses the antimeridian.
- `GET /api/places/search?q=mumbai&limit=12`: searches name, city and address; requires 2–120 characters and caps at 40.
- `GET /api/places/:id`: one place by UUID. 400 on a malformed id, 404 when absent.
- `POST /api/places`: requires a Better Auth session and `halalConfirmed: true`; accepts `mode: google` with a selected `googlePlaceId`, or `mode: manual` with name, address and city. Returns 201 with the new place id, 401 for sign-in, 409 for a duplicate, and 429 when the durable submission budget is exhausted.
- `GET /api/places/saved`: requires a Better Auth session and returns up to 200 saved halal places, newest first. Unauthenticated requests return 401 with a `/login?returnTo=%2Fsaved` hint.
- `POST/DELETE /api/places/:id/saved`: requires a Better Auth session, validates the UUID and confirms the target is an existing halal listing. Both methods return the resulting `saved` state and 429 when either save-action bucket is exhausted.
- `GET /api/places/google-search?q=...`: requires a Better Auth session and uses server-only Google Places (New) Text Search when configured. It is rate-limited separately from submissions.
- `GET /api/cities/:citySlug`: aggregate for one city, including the mean of its listed coordinates for map centring.
- `src/lib/places.ts` also exposes `getPlaceById`, `listCities`, `countCities`, `getCity`, `findPlacesByCity`, `countPlaces` and `listPlaceRefs` for the server-rendered routes. Every one is parameterized and limit-clamped; none writes.
- Responses contain `places`, `total` (all matching rows) and `limit`. The count pill shows the viewport total; the sheet explains when only the top 600 are shown. Results are ordered by rating, reviews, then ID.
- Queries filter directly on non-null `places.lat` / `places.lng`, allowing the existing `places_lat_lng_idx` to serve viewport bounds. The server counts matches and only sends the capped selection to the client.
- Ops has populated all 11,957 coordinates with city centroids plus about 1–3 km of jitter. These are **approximate locations**, not verified restaurant coordinates. The UI asks visitors to confirm the address. There is no runtime centroid fallback or client-side jitter.
- `src/data/city_coords.json` is retained as a reference only; it is not imported into runtime code.
- SQL values are parameterized; search wildcard characters are escaped. API failures return generic errors without database details or credentials.

## Cloudflare deployment

Authenticate with `npx wrangler login`, or provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through your shell/CI secret store. Use credentials authorized to deploy Workers.

```sh
npm run build
npx wrangler secret put DATABASE_URL
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put GOOGLE_PLACES_API_KEY
npm run deploy
```

Set these Worker variables in the relevant environment before deploy:

```dotenv
BETTER_AUTH_URL=https://halalfood.world
TURNSTILE_SITE_KEY=<public Cloudflare Turnstile site key>
EMAIL_FROM=noreply@halalfood.world
```

`TURNSTILE_SITE_KEY` may be a normal public Worker variable (or a dashboard secret if preferred); only `TURNSTILE_SECRET_KEY` belongs in `wrangler secret put` and it must never be sent to the browser. `BETTER_AUTH_URL` must match the public origin so Better Auth can validate origins and issue HTTPS/SameSite cookies. Keep the local `.dev.vars` values separate from production. `DATABASE_URL`, `RESEND_API_KEY`, `BETTER_AUTH_SECRET`, `TURNSTILE_SECRET_KEY`, and `GOOGLE_PLACES_API_KEY` are secret names only here; enter their values at the Wrangler prompts. Use `GOOGLE_MAPS_API_KEY` instead only when retaining an existing secret name.

Enter the existing Neon connection string, Resend API key, Better Auth secret, and Turnstile server secret at their respective Wrangler prompts. If Wrangler asks to create the named Worker before its first deployment, accept. The generated Worker name is `halalfood-world`; `npm run deploy` invokes `@vinext/cloudflare` against `dist/server/wrangler.json`. Equivalent:

```sh
npx @vinext/cloudflare deploy --config dist/server/wrangler.json
```

Wrangler prints the workers.dev URL on success. Configure the custom domain `halalfood.world` in Cloudflare after deployment if desired. Local `.dev.vars` does **not** upload production secrets. Set `EMAIL_FROM` as a Worker variable (or leave the preferred default), and use `onboarding@resend.dev` until the custom domain is verified. No tile token is needed. Deployment also requires Cloudflare authentication.

The optional email smoke check is disabled unless `EMAIL_HEALTHCHECK_ENABLED=true`. To enable it, configure `EMAIL_HEALTHCHECK_TO` and store a long random bearer token as `EMAIL_HEALTHCHECK_TOKEN` (use `npx wrangler secret put EMAIL_HEALTHCHECK_TOKEN` for production), then send an authenticated `POST` to `/api/admin/email/healthcheck` with `Authorization: Bearer <token>`. The endpoint has no request-supplied recipient and returns 404 while disabled, so it cannot be used as an unauthenticated spam endpoint. Use it only for occasional operator checks; it is not a queue or mass-mailing mechanism.

The framework deployment setup follows the [official vinext documentation](https://github.com/cloudflare/vinext). Basemap availability depends on CARTO; review its service terms before scaling traffic.
