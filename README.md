# halalfood.world

A halal food guide built with vinext, React, MapLibre GL, Drizzle and Cloudflare D1, deployed as a Cloudflare Worker. The interface uses CARTO Positron with OpenStreetMap attribution.

**How a place gets verified.** People who eat somewhere answer four questions: Is it Muslim-owned? Is it halal certified? Does it serve pork? Does it serve alcohol? Each answer is Yes, No or Not sure. A fact is settled when the three most recent definite answers from different accounts agree, and a place is **Community verified** when all four facts are settled. Until then it shows "n of 3 checks" or "Not checked yet" (which never means "not halal"). A check counts the moment it is sent, a person's latest check at a place is the only one that counts, and an account must be 24 hours old before its checks count. The rules live in [`packages/core/src/halal.ts`](packages/core/src/halal.ts) and [`docs/product/halal-model.md`](docs/product/halal-model.md); the full design is [`docs/product/simplified-community-spec.md`](docs/product/simplified-community-spec.md).

**Everything social is context, never evidence.** Follows, the Friends feed, likes, comments, lists, recs, events, points and creator videos help people decide where to eat, but none of them can change a place's status. Places can only be added from a Google Maps result and go live at once, with the adder's answers as the first check. Moderators act on reports and nothing else.

Brand PNGs in `apps/web/public/` are rendered from `apps/web/public/icon.svg` with `node apps/web/scripts/generate-assets.mjs` (set `PLAYWRIGHT_CHROMIUM_PATH` if Chromium isn't in Playwright's default location).

## Repository layout

This is an npm workspaces monorepo driven by [Turborepo](https://turborepo.com), laid out so a mobile app can sit beside the web app and share its code:

| Path | Package | What it holds |
| --- | --- | --- |
| `apps/web` | `@halalfood/web` | The vinext/Cloudflare Worker web app: routes, API handlers, D1 schema and migrations, server-only libraries, scripts and web tests. |
| `packages/core` | `@halalfood/core` | Platform-agnostic domain logic with no DOM, database or Worker dependencies: the halal status algorithm and filters (`halal`), check validation (`check`), points, people (handles, names, the follow rule), recs, reports and moderation actions, the food passport, reel-to-place matching, place submission and route params. Import as `@halalfood/core/<module>`. |
| `packages/ui` | `@halalfood/ui` | [shadcn/ui](https://ui.shadcn.com) components (radix-nova style, [Hugeicons](https://hugeicons.com) icons) and the Tailwind theme tokens. Import as `@halalfood/ui/components/<name>`; the stylesheet is `@halalfood/ui/globals.css`. |

A future `apps/mobile` (for example Expo/React Native) can depend on `@halalfood/core` directly and call the web app's `/api` routes. `@halalfood/ui` is web-only, since it renders DOM elements.

**Styling.** Pages are composed from shadcn/ui components; there is no hand-written stylesheet. Colours, radii and fonts are theme tokens in `packages/ui/src/styles/globals.css` (primary is the tandoor orange, plus `success`, `warning` and `info` tokens used for halal status tones), and layout uses Tailwind utilities on those components. App-level building blocks shared by several pages live in `apps/web/src/components` (`kit` for buttons, pills, meters and art; `kit-client` for sheets, toasts and the save heart; `app-shell` and `nav-tabs` for the five-tab frame). To add a shadcn component, run it from the UI package so it lands in `packages/ui/src/components`:

```sh
cd packages/ui && npx shadcn@latest add <component>
```

**Icons** come from Hugeicons: `import { HugeiconsIcon } from "@hugeicons/react"` with an icon from `@hugeicons/core-free-icons`.

Root scripts (`npm run dev`, `build`, `typecheck`, `test`, `start`, `deploy`) run through Turborepo. App-specific scripts such as the database migrations, backfills and smoke tests live in `apps/web/package.json`; the root forwards the common ones (`db:migrate:local`, `db:migrate:remote`, `backfill:*`, `test:api`, `test:browser`), and anything else runs from `apps/web` or with `npm run <script> -w @halalfood/web`. Paths below that name app files (`wrangler.jsonc`, `migrations/`, `scripts/`, `src/`, `.dev.vars`) are relative to `apps/web`.

## Local setup

Use Node 22:

```sh
export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.local/share/fnm:$PATH"
node --version
npm ci
```

The database is Cloudflare D1 (SQLite), bound as `DB` in [`wrangler.jsonc`](apps/web/wrangler.jsonc). Create a local database and apply the migrations once:

```sh
npx wrangler d1 create halalfood-world
# Paste the printed database_id into wrangler.jsonc's d1_databases entry.
npm run db:migrate:local
```

`npm run dev` (via the Cloudflare Vite plugin) and `npm start` (via `wrangler dev`) both emulate the `DB` binding locally against the SQLite file under `.wrangler/state`, so no connection string is needed for local development.

Create a **gitignored** `.dev.vars` in `apps/web` containing the local-only email and auth settings below. Do not put secrets in client variables or commit this file. The Cloudflare Vite plugin loads it; the Worker reads bindings through `process.env.*` with Node compatibility enabled.

```dotenv
RESEND_API_KEY=<your Resend API key>
EMAIL_FROM=noreply@halalfood.world
BETTER_AUTH_SECRET=<long random Better Auth secret>
BETTER_AUTH_URL=http://localhost:3000
TURNSTILE_SITE_KEY=<public Cloudflare Turnstile site key>
TURNSTILE_SECRET_KEY=<Cloudflare Turnstile server secret>
GOOGLE_PLACES_API_KEY=<your Google Places API key>
# GOOGLE_MAPS_API_KEY=<fallback Google Maps API key>
# Optional. Overrides the public SENTRY_DSN var in wrangler.jsonc for local Workers.
# SENTRY_DSN=
# Optional build-time override for the browser SDK. Falls back to SENTRY_DSN.
# NEXT_PUBLIC_SENTRY_DSN=
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

The Crisp chat widget (`src/components/crisp-chat.tsx`) loads on every page and, when someone is signed in, sets their email and name on the Crisp session automatically. Signed-out visitors stay anonymous, and signing out resets the chat session. This is identify only. Do not turn on Crisp's "Verify your users' identity" setting, and do not add an identity secret.

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

Use the URL printed by the dev server. Development runs against the local D1 database and production against the deployed one; map/listing reads remain bounded, while Better Auth, saved-place, and rate-limit writes use the migrations below.

## Routes

The app has five tabs (Explore, Friends, Add, Saved, You), a top bar at ≥ 768 px, and a one-line footer. Sheets (How verification works, Report, Send, New list, Add to a list) set `?sheet=` so the back button closes them.

| Route | Auth | Screen |
| --- | --- | --- |
| `/`, `/city/[slug]` | – | Explore: city switcher, search, This week in {city}, Guides & lists, filter chips and places. |
| `/cities` | – | Choose a city. |
| `/search` | – | Places, people, lists and cities. |
| `/map` | – | The map, with the same filters as Explore. |
| `/place/[id]` | – | A place: status, the four facts, actions, friends, dishes, photos, videos, notes, nearby. |
| `/place/[id]/check` | ✓ | Check a place: the four questions, how it was, dishes, photos, a note, then Check sent. |
| `/add`, `/add/video` | search –, submit ✓ | Add a place from Google Maps; save a place from a TikTok, Reel or YouTube link. |
| `/login` | – | Email code sign-in with Turnstile. A new account goes to `/welcome`. |
| `/welcome` | ✓ | First sign-in: profile, what matters, follow a few people. |
| `/saved` | ✓ | Saved places and lists. |
| `/list/[id]` | visibility | A ranked list, a plan with friends, or a guide. |
| `/friends`, `/visit/[id]` | ✓ / visibility | The Friends feed and one visit with likes and comments. |
| `/inbox` | ✓ | Activity and Recs. |
| `/u/[handle]`, `/invite/[handle]` | visibility / – | Someone's profile; an invite landing. |
| `/community` | – | The points leaderboard per city, this week or all time. |
| `/events`, `/event/[id]` | – | Halal food events and their stalls. |
| `/creator/[platform]/[handle]` | – | Places from a creator's videos. |
| `/me`, `/me/settings`, `/me/privacy` | ✓ | You (Passport, Checks, Lists), Settings, Privacy & people. |
| `/admin` | moderator | Reports and Events. |

### API

| Method & path | Purpose |
| --- | --- |
| `GET /api/places` | Explore and map: `city`, `bbox`, `near`, `filters`, `friends`, `offset`, `limit`. |
| `POST /api/places` | Add a place from a Google result with optional answers. 409 with the id for a duplicate. |
| `GET /api/places/google-search` | Google Places text search for Add, rate-limited and capped per day; marks results already listed. |
| `GET /api/places/[id]`, `GET/POST /api/places/[id]/checks`, `GET /api/places/[id]/notes` | A place, its checks, and its shared notes. |
| `GET/POST /api/places/[id]/photos`, `DELETE …/photos/[photoId]`, `GET /api/photos/[...key]` | Photos (JPEG, PNG or WebP, 8 MB) and the R2 proxy. |
| `POST/DELETE /api/places/[id]/saved`, `GET /api/places/saved` | Saves. |
| `GET/POST /api/places/[id]/media`, `POST /api/media/match` | Video links and matching a pasted link to a place. |
| `GET /api/search`, `GET /api/cities/nearest` | Search; nearest city. |
| `GET/PUT/DELETE /api/me`, `POST/DELETE /api/me/avatar`, `POST /api/me/onboarding`, `GET /api/handles/check`, `GET /api/avatars/[handle]` | Profile, settings, account deletion, photo, onboarding and handles. |
| `PUT/DELETE /api/follows/[handle]`, `POST/DELETE /api/follow-requests/[handle]`, `PUT/DELETE /api/blocks/[handle]`, `GET /api/people/suggested`, `GET /api/u/[handle]` | People. |
| `GET /api/feed`, `GET /api/checks/[id]`, `PUT/DELETE /api/checks/[id]/like`, `GET/POST /api/checks/[id]/comments`, `DELETE /api/comments/[id]` | Feed, visits, likes and comments. |
| `GET /api/inbox`, `POST /api/inbox/read`, `GET /api/inbox/summary`, `GET /api/recs/recipients`, `POST /api/recs`, `POST /api/recs/[id]/reply` | Inbox and recs. |
| `GET/POST /api/lists`, `GET /api/lists/mine`, `GET/PUT/DELETE /api/lists/[id]`, `PUT /api/lists/[id]/items`, `POST/DELETE /api/lists/[id]/items/[placeId]`, `POST /api/lists/[id]/members`, `POST …/members/accept`, `DELETE …/members/[handle]`, `PUT/DELETE /api/lists/[id]/save` | Lists. |
| `GET /api/community`, `GET /api/events`, `GET /api/events/[id]`, `PUT/DELETE /api/events/[id]/going`, `GET /api/creators/[platform]/[handle]` | Community and events. |
| `POST /api/reports` | Report a place, check, comment, person or list. |
| `GET /api/admin/reports`, `POST /api/admin/reports/[id]`, `GET/POST /api/admin/events`, `GET/PUT/DELETE /api/admin/events/[id]` | Moderation. Every action writes `audit_log`. |
| `/api/auth/*`, `POST /api/admin/email/healthcheck` | Better Auth; the optional email smoke check. |

Every write needs a session and spends a per-user and per-IP budget (checks 20 a day, places 10, recs 30, reports 10, comments 100). Reads that show checks apply one visibility rule: unshared checks are the author's alone, nothing crosses a block, and a private account's checks show only to accepted followers. `tests/check-visibility-audit.test.ts` fails if a query over `checks` doesn't say which audience it serves.

## Google Places coordinate backfill

The server-side client is in `src/lib/google-places.ts` and calls Place
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
Cloudflare's D1 REST API (`scripts/d1-rest-client.ts`) instead of `src/db`. It
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

### Mumbai Place Details backfill

The Mumbai-only payload backfill is safe to commit and runs sequentially through
the same D1 client. It uses the legacy Place Details endpoint without a `fields`
query parameter because the Places API (New) is blocked on this key. It waits
about 250ms between Google calls, does not change `name` or `street_address`,
and skips rows that already have a non-empty `google_place_payload`.

Ops should apply `npm run db:migrate:remote` first. Wrangler skips
`0008_place_google_payload.sql` once that file is recorded in `d1_migrations`.
Set these environment
variables with placeholders from the production secret store:

```sh
export CLOUDFLARE_ACCOUNT_ID=<your Cloudflare account id>
export CLOUDFLARE_D1_DATABASE_ID=<the halalfood-world D1 database id>
export CLOUDFLARE_API_TOKEN=<a token with D1 edit permission>
export GOOGLE_PLACES_API_KEY=<your Google Places API key>

npm run backfill:mumbai-place-details
```

There is no city flag: this command only processes `city_slug = 'mumbai'`.

## Email OTP auth

The `/login` page renders a Cloudflare Turnstile widget, then uses the Better Auth `emailOTP` plugin to request and verify a 6-digit sign-in code. The client uses `emailOTPClient`; successful verification creates a database-backed Better Auth session and secure, HTTP-only cookie. OTP mail is sent only through `src/lib/email.ts`, uses `EMAIL_FROM` when set, and includes both text and HTML bodies.

Turnstile is fail closed: the request endpoint returns an error when either `TURNSTILE_SITE_KEY` or `TURNSTILE_SECRET_KEY` is missing, when no token is supplied, or when Cloudflare rejects the token. The site key value is rendered to the browser. On the Worker it is still stored as a secret, because a plain var of the same name would replace it. `TURNSTILE_SECRET_KEY`, `BETTER_AUTH_SECRET`, and `RESEND_API_KEY` must never be client-exposed or committed. A preview version (`ENVIRONMENT=preview`, written by preview builds) served on a `*.workers.dev` host uses Cloudflare's always-pass test keys. Every other request uses the production keys, including `halalfood.world` and the production Worker's own workers.dev URLs (`halalfood-world.<account>.workers.dev` and `<version>-halalfood-world.<account>.workers.dev`), which bind the production D1 database. `BETTER_AUTH_URL` is not read for this. On a preview version, sign-in mail is logged and not sent through `RESEND_API_KEY` unless `PREVIEW_RESEND_API_KEY` is set.

Rate limits use D1, not KV (this Worker has no KV binding). Better Auth's database-backed IP/endpoint limiter uses the `rate_limit` table. The auth route also uses the `auth_otp_rate_limit` table with SHA-256 hashed email/IP keys, read and written inside a `db.transaction()`: D1 is a single Durable Object per database, so the transaction already serializes concurrent writers the way Postgres advisory locks used to:

- OTP requests: one email can send at most 5 codes per 24 hours with a 60-second cooldown; one IP can send at most 30 per 24 hours with a 10-second cooldown.
- OTP verification: at most 5 attempts per email and 20 per IP per 15 minutes. The budget is consumed before checking a submitted code, so concurrent guesses cannot bypass it. Better Auth also invalidates an OTP after 3 wrong attempts, and codes expire after 5 minutes.

Place submissions reuse the same durable table and transactional pattern,
with separate hashed key namespaces: one signed-in user may submit at most 5
places per 24 hours with a 60-second cooldown, and one IP may submit at most 30
per 24 hours with a 10-second cooldown. Google Text Search stays available
while signed out. Anonymous callers are limited by the `GOOGLE_SEARCH_ANON`
Workers Rate Limiting binding (5 requests per 60 seconds per IP). Signed-in
callers use `GOOGLE_SEARCH_USER` (20 requests per 60 seconds per user). Those
bindings count inside one Cloudflare location. A D1 counter,
`google_search_daily`, caps Google calls for the whole site
(var `GOOGLE_SEARCH_DAILY_CAP`, default 1000 per UTC day). Queries shorter
than 3 characters and cache hits never call Google. Repeated text, after
lowercasing, trimming, and collapsing whitespace, shares a cache entry for
6 hours, bucketed by location or bbox when the query has one. When the daily
cap is reached the route returns listed D1 places and the add-with-a-link
fallback instead of an error. If the rate-limit binding is missing, the older
D1 buckets still apply: 30 requests per signed-in user per hour and 120 per
IP per hour.
Production uses rate-limit namespaces 81001 (anonymous) and 81002
(signed-in). Workers Builds and GitHub preview uploads rewrite them to 81101
and 81102, and refuse to upload if any rate limit still uses a production
namespace.

Save and unsave mutations reuse the same durable table with their own hashed
key namespace: one user may perform at most 120 save actions per hour with a
250ms cooldown, and one IP may perform at most 300 per hour with a 100ms
cooldown. Both the user and IP bucket must allow the mutation.

Place rating mutations use a separate hashed key namespace and the same durable
limiter: one user may perform at most 120 rating actions per hour with a
250ms cooldown, and one IP may perform at most 300 per hour with a 100ms
cooldown. Both the user and IP bucket must allow the mutation. The accepted
halal reaction values are `mashallah`, `alhamdulillah`, and `astaghfirullah`.

Place review mutations use their own hashed key namespace and the same durable
limiter: one user may perform at most 120 review actions per hour with a
250ms cooldown, and one IP may perform at most 300 per hour with a 100ms
cooldown. Invalid review payloads are rejected before either bucket is spent.

Community halal verification submissions reuse the same durable limiter
with separate hashed key namespaces: one signed-in user may submit at most 5
verifications per 24 hours with a 60-second cooldown, and one IP may submit at
most 30 per 24 hours with a 10-second cooldown. Both the user and IP bucket
must allow the submission. New verification rows start as `pending`; the
public place page shows approved rows and the signed-in submitter's own
pending rows.

R2 uploads have separate hashed storage budgets of 20 files per user per day
and 60 files per IP per day. This keeps the direct upload path bounded before
a verification record is created while allowing one submission to include
multiple evidence files.

Place photo uploads use the same durable limiter with a `place-photo` namespace:
20 uploads per signed-in user per day and 60 per IP per day. Photo deletion uses
the standard authenticated mutation buckets of 120 actions per user per hour
and 300 per IP per hour. Validated photo input is checked before either upload
bucket is spent.

The limiter fails closed if D1 is unavailable, so a provider outage cannot turn the endpoint into an unrestricted Resend sender. Old limiter rows can be pruned by Ops after confirming the retention policy; they contain hashes rather than raw identifiers.

### Auth schema migration

The schema is one baseline, [`migrations/0001_baseline.sql`](apps/web/migrations/0001_baseline.sql) (D1/SQLite: `text` ids, Unix-millisecond timestamps, `0`/`1` booleans, JSON arrays as text). It creates the Better Auth tables, the OTP limiter, places with their `place_status` projection, checks, people, social, lists, events, recs, notifications, points and reports. `src/db/schema.ts` mirrors it. The app is live. Production moved to this baseline on Oct 5, 2026 by cutting over to a new D1 database, `halalfood-world-v2`; the pre-cutover database `halalfood-world` is kept untouched for rollback ([docs/ROLLBACK.md](docs/ROLLBACK.md)). From here on, schema changes are new numbered, additive migrations applied before the deploy (the deploy gate refuses pending ones). Never drop or reset the production database.

For a local or preview database only, place listings can be carried across a reset like this. Production never takes this path; the Oct 5 cutover imported old prod's places into the new database as reviewed SQL instead:

```sh
npm run places:export -w @halalfood/web -- seed/places.jsonl   # before
npm run db:migrate:remote                                       # baseline
npm run places:import -w @halalfood/web -- seed/places.jsonl   # after
```

Only listed rows and the columns the new schema keeps are carried. Every place comes back as "Not checked yet".

```sh
npm run db:migrate:local   # local development database
npm run db:migrate:remote  # deployed production D1 database (halalfood-world-v2)
```

Do not apply production migrations by splitting a file into statements: `wrangler d1 execute --command` treats a leading `--` comment as a flag, and a semicolon inside a comment is not a statement boundary.

Dynamic segments are validated before they reach SQL: `citySlugParam` accepts only lowercase kebab-case, `placeIdParam` only UUIDs, and `pageParam` clamps the page index. An unparseable segment is a 404 and never costs a query.

City and place pages distinguish a missing row (a real 404) from an unreachable database (a `noindex, follow` "temporarily unavailable" page). A transient outage must never be indexed as if it were the page's content.

### Deep links and sharing

- `/map?city=<slug>`, `/map?place=<uuid>` and `/map?filters=…` open the map framed on a city, a place or a filter set.
- Places, lists, events and profiles carry a Share control: Web Share where available, otherwise the link is copied.
- Signed-in people can Send a place, list or event to people they follow or who follow them; it arrives in the recipient's Inbox.

## SEO, AEO and GEO

- Root `metadata` in `app/layout.tsx` sets `metadataBase`, a title template, canonical, Open Graph, Twitter, robots, icons and the manifest. City and place pages override title, description, canonical and Open Graph per route.
- Paginated city views (`?page=2`) canonicalise to page one so ranking signals stay on a single URL.
- JSON-LD marks coordinates with `additionalProperty: locationPrecision = approximate`, and carries the same disclaimer the UI shows. Do not remove it: the coordinates are city centroids plus jitter, and structured data that implies otherwise would be misleading.
- `src/lib/seo.ts` holds the pure title/description/JSON-LD helpers and is unit-tested in `tests/seo.test.ts`.

### Sitemap strategy

`/sitemap.xml` is a **sitemap index**, not a urlset. ~12k places and a few hundred cities would fit in one file, but that would mean one large query per crawl and a full re-fetch whenever any row changes. The index points at:

| Child | Contents |
| --- | --- |
| `/sitemaps/core/sitemap.xml` | Home, the city directory, events and community. |
| `/sitemaps/cities/sitemap.xml` | One entry per distinct `city_slug`, capped at 2,000. |
| `/sitemaps/places/sitemap/N.xml` | Places, 5,000 per file, from an id-ordered scan so chunk boundaries stay stable. |
| `/sitemaps/social/sitemap.xml` | Public lists, public profiles with a shared check, and upcoming events. |

`robots.txt` disallows `/api/`, `/search` and the signed-in screens (`/me`, `/saved`, `/inbox`, `/friends`, `/admin`, `/welcome`, `/add`, `/login`). Place, city, list and profile pages render the viewer's saves and friends on the server, so only `/cities` and the sitemaps are cached at the edge.

`MAX_PLACE_CHUNKS` in `src/lib/sitemap.ts` caps the index at 50 chunks if the table ever grows far beyond its current size. If the count query fails, the index still advertises the core and city sitemaps rather than returning nothing.

## Brand assets

`public/` holds an SVG favicon, PNG icons (32, 180, 512) and the 1200x630 Open Graph image, plus `site.webmanifest`. The PNGs are drawn from primitives by `scripts/generate-assets.mjs` and committed, so the build needs no image toolchain and the repo carries no design exports:

```sh
node scripts/generate-assets.mjs
```

## Data and bounded APIs

- Every list endpoint is limit-clamped and parameterized; search escapes wildcard characters and caps `q` at 64 characters.
- Status is computed in TypeScript and written to `place_status` in the same D1 batch as the check, so Explore, the map and search filter with plain SQL. Filters match the fact's current value, settled or not; Verified needs all four settled.
- A status flip writes `place_status_changes` and tells everyone who saved the place.
- Points (3 a check, 5 for adding a place, 10 for helping verify one) are an append-only ledger with one award per kind, place and person per day. They rank the Community board and never touch status.
- Coordinates come from Google Places when a place is added; older rows may carry approximate city-centre coordinates until backfilled.
- API failures return generic errors without database details or credentials.

## Cloudflare deployment

Authenticate with `npx wrangler login`, or provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through your shell/CI secret store. Use credentials authorized to deploy Workers and manage D1.

Create the production D1 database once, fill its printed `database_id` into [`wrangler.jsonc`](apps/web/wrangler.jsonc)'s `d1_databases` entry, and apply the migrations:

```sh
npx wrangler d1 create halalfood-world
npm run db:migrate:remote
```

```sh
npm run build
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put GOOGLE_PLACES_API_KEY
npm run deploy
```

Set these Worker variables in the relevant environment before deploy:

```dotenv
BETTER_AUTH_URL=https://halalfood.world
EMAIL_FROM=noreply@halalfood.world
```

`TURNSTILE_SITE_KEY` is not in that list. It is stored as a Worker secret (`npx wrangler secret put TURNSTILE_SITE_KEY`), even though the browser receives the value. A plain text var of the same name replaces the secret.

`SENTRY_DSN` is already set as a public var in [`wrangler.jsonc`](apps/web/wrangler.jsonc) (production and the generated preview config). It is not a secret: do not also run `wrangler secret put SENTRY_DSN`, because a var and a secret with the same name conflict on deploy. The browser SDK reads `NEXT_PUBLIC_SENTRY_DSN` at build time and, when that is unset, the same `SENTRY_DSN` value. Set `NEXT_PUBLIC_SENTRY_DSN` in the Workers Builds environment only to override it. Set an `ENVIRONMENT` Worker variable when you want Sentry events tagged with something other than the Node environment (`production` in a production build, `development` locally). Preview uploads set `ENVIRONMENT=preview`: Workers Builds non-main branches write it into the staged Wrangler config, and the GitHub preview workflow passes `--var ENVIRONMENT:preview`. Sentry then reports those events with environment `preview`.

### Migration gate

Workers Builds on `main` runs `npm run build`, then `npx wrangler deploy`. At the end of the build, `scripts/stage-cloudflare-build.ts` reads the `DB` binding's `database_name` and `database_id` from [`apps/web/wrangler.jsonc`](apps/web/wrangler.jsonc), runs this for that database, and exits non-zero when it fails, when the binding is missing or malformed, or when it lists anything still pending:

```sh
npx wrangler d1 migrations list halalfood-world-v2 --remote
```

A failing build stops Workers Builds before `wrangler deploy`. The gate does not apply migration files. It runs only when `WORKERS_CI=1` and `WORKERS_CI_BRANCH=main`. Preview builds and GitHub Actions skip it. The list command has a 60 second timeout; a timeout fails the build the same way a failed command does.

Applying the pending migrations does not resume the build that already failed. Retry that main build in Workers Builds, or push a commit, so the gate runs again against an empty pending list.

`npm run deploy` and `npx wrangler deploy` do not run this gate. They publish the Worker that is already built.

Migrations are applied before the deploy that needs them, and the previous Worker keeps serving until that deploy succeeds. Write each migration so the code already in production still works after it is applied: add columns and indexes, and leave renames and drops for a later deploy that no longer reads the old shape.

The Workers Builds API token needs **D1 Edit** on the account, as well as the Workers Scripts Edit permission the deploy already uses. Wrangler 4's `migrations list` reads `d1_migrations` and ensures that table exists (`CREATE TABLE IF NOT EXISTS`). D1 Read is not enough for that statement. The command does not run the SQL files under `migrations/`. Add D1 Edit to the token selected in the Worker's **Settings → Builds → API token**. If the token cannot list migrations, the build fails closed and does not deploy.

`TURNSTILE_SITE_KEY` is stored as a Worker secret, not a plain var. The login page reads it from the Worker env on each request and passes it to the widget, so `wrangler secret put TURNSTILE_SITE_KEY` takes effect without a rebuild. It must not be a `NEXT_PUBLIC_` build variable, and it must not be written into Wrangler `vars`. A plain var with that name replaces the secret on the version chain. Only the value is public: it is sent to the browser. `TURNSTILE_SECRET_KEY` must never be sent to the browser. `BETTER_AUTH_URL` must match the public origin so Better Auth can validate origins and issue HTTPS/SameSite cookies. Keep the local `.dev.vars` values separate from production. `RESEND_API_KEY`, `BETTER_AUTH_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `GOOGLE_PLACES_API_KEY` are secret names only here; enter their values at the Wrangler prompts. Use `GOOGLE_MAPS_API_KEY` instead only when retaining an existing secret name.

Enter the Resend API key, Better Auth secret, and Turnstile server secret at their respective Wrangler prompts. If Wrangler asks to create the named Worker before its first deployment, accept. The generated Worker name is `halalfood-world`; `npm run deploy` invokes `@vinext/cloudflare` against `dist/server/wrangler.json`. Equivalent:

```sh
npx @vinext/cloudflare deploy --config dist/server/wrangler.json
```

### Resetting a deployed database

See [Auth schema migration](#auth-schema-migration): export the places, drop and recreate the database, apply the baseline, and import the places.

Wrangler prints the workers.dev URL on success. Configure the custom domain `halalfood.world` in Cloudflare after deployment if desired. Local `.dev.vars` does **not** upload production secrets. Set `EMAIL_FROM` as a Worker variable (or leave the preferred default), and use `onboarding@resend.dev` until the custom domain is verified. No tile token is needed. Deployment also requires Cloudflare authentication.

The optional email smoke check is disabled unless `EMAIL_HEALTHCHECK_ENABLED=true`. To enable it, configure `EMAIL_HEALTHCHECK_TO` and store a long random bearer token as `EMAIL_HEALTHCHECK_TOKEN` (use `npx wrangler secret put EMAIL_HEALTHCHECK_TOKEN` for production), then send an authenticated `POST` to `/api/admin/email/healthcheck` with `Authorization: Bearer <token>`. The endpoint has no request-supplied recipient and returns 404 while disabled, so it cannot be used as an unauthenticated spam endpoint. Use it only for occasional operator checks; it is not a queue or mass-mailing mechanism.

### R2 photos

The web app's [`wrangler.jsonc`](apps/web/wrangler.jsonc) declares the `HALAL_EVIDENCE_R2` binding and the bucket `halalfood-world-evidence`. Create it once in the target account:

```sh
npx wrangler r2 bucket create halalfood-world-evidence
```

Place photos and profile photos are uploaded straight to the Worker (multipart, JPEG, PNG or WebP, 8 MB for places and 2 MB for profiles), checked by content type and file signature, and stored under account-hashed keys (`photos/…`, `avatars/…`). They are served through `GET /api/photos/[...key]` and `GET /api/avatars/[handle]`. Deleting an account deletes its photos.

`npm run build` carries the `r2_buckets` declaration into `dist/server/wrangler.json`. Do not hand-edit `dist`.

The framework deployment setup follows the [official vinext documentation](https://github.com/cloudflare/vinext). Basemap availability depends on CARTO; review its service terms before scaling traffic.

## Pull request previews

The repository includes `.github/workflows/preview.yml` for Vercel-style previews on same-repository pull requests:

- Each PR creates or reuses a Cloudflare D1 database named `halalfood-world-pr-<number>`.
- Before upload, the deploy job applies every migration under `migrations/` to that database with `wrangler d1 migrations apply --remote`. A migration failure fails the preview.
- The Cloudflare Worker is uploaded as a non-production version bound to that PR's D1 database and the shared R2 bucket `halalfood-world-evidence-preview`, with a stable `pr-<number>` preview alias. The predicted URL is `https://pr-<number>-halalfood-world.wahabshaikh.workers.dev`.
- The workflow creates or updates one GitHub Deployment in the `preview` environment and adds or updates one preview URL comment in the PR.
- When the PR closes, all Cloudflare preview versions with the upload message `PR #<number>` are deleted so the alias no longer has a retained version target. The PR's D1 database is also deleted. The shared preview R2 bucket is kept.

Configure these GitHub Actions settings before opening a PR:

| Setting | Type | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Repository secret | Cloudflare preview upload, D1 database create/migrate/delete, version lookup, and cleanup |
| `CLOUDFLARE_ACCOUNT_ID` | Repository secret | Cloudflare account ID |

`CLOUDFLARE_API_TOKEN` needs Workers Scripts edit and D1 edit permissions. Fork pull requests are intentionally skipped because the preview deployment requires infrastructure credentials.

The upload uses `--keep-vars` and rebinds `DB` and `HALAL_EVIDENCE_R2` before upload. It reuses production Worker variables and secrets for Google Places and `BETTER_AUTH_SECRET`. Evidence uploads go to `halalfood-world-evidence-preview`, not `halalfood-world-evidence`. Preview hosts do not send mail with the inherited `RESEND_API_KEY`.

Preview versions are versions of the production Worker `halalfood-world`. A plain text variable whose name matches a production secret replaces that secret on the uploaded version and on every later version, including main deploys. The pr-50 preview uploads on 30 Sep 2026 did this to `TURNSTILE_SITE_KEY`; main deploys then shipped without the secret until it was put back on version `09382d48`.

Preview builds do not keep their own list of secret names. Before a preview upload, `scripts/stage-cloudflare-build.ts` (Workers Builds, non-main) and `scripts/bind-github-preview.ts` (GitHub deploy) run:

```sh
npx wrangler secret list --name halalfood-world --format json
```

That command prints names, not values. Every returned name is removed from the staged Wrangler vars. If the command fails or times out, the preview build stops. The GitHub preview upload may set only `BETTER_AUTH_URL` and `ENVIRONMENT`. If either name appears in the secret list, the build stops instead of passing it as `--var`. Do not pass `TURNSTILE_SITE_KEY` from the GitHub Actions secret into that step. `pull_request_target` runs this workflow from the default branch, so the list check in the deploy job applies to later previews after this change is on `main`. Workers Builds runs the staging script from the branch being built.

The login page and the Turnstile check use Cloudflare's always-pass test keys only when the request host is `*.workers.dev` and the version has `ENVIRONMENT=preview`: site key `1x00000000000000000000AA` and secret `1x0000000000000000000000000000000AA`. Both are required. A request whose host is `halalfood.world` uses the production keys, including when `ENVIRONMENT` is `preview`. The production Worker is also served on workers.dev and has no `ENVIRONMENT` var, so it uses the production keys there too. Workers Builds previews set `BETTER_AUTH_URL` to `https://halalfood.world`, so that URL is not used. Production secret keys reject tokens from the test site key, so the pair stays inside that lookup and is never written onto the Worker.

On a preview version served from `*.workers.dev`, OTP mail is not sent with `RESEND_API_KEY`. The Worker logs the message, including the sign-in code, and does not call Resend. Set `PREVIEW_RESEND_API_KEY` only when a preview should send real mail. That name is not `RESEND_API_KEY`. Preview versions still inherit the production key through `--keep-vars`; they do not use it for mail.

Workers Builds non-main branches do not run this workflow. `scripts/stage-cloudflare-build.ts` rewrites the staged Wrangler config for those builds to D1 `halalfood-world-preview` (`c5d8e0ff-c001-48b8-8545-49861227c16f`) and the same preview R2 bucket, then applies migrations to that preview database only. Production branch `main` keeps `halalfood-world` and `halalfood-world-evidence`. Those non-main builds also list production secret names and strip them from vars. `ENVIRONMENT=preview` is set only when that name is not itself a production secret.

`TURNSTILE_SITE_KEY` is not in `wrangler.jsonc` because it is a Worker secret, not a git-stored var. The login page and the verify call read it from the Worker env at request time (`cloudflare:workers`) unless the request is a preview version on `*.workers.dev`. Set or rotate it from `apps/web` with:

```sh
npx wrangler secret put TURNSTILE_SITE_KEY --name halalfood-world
```

Check with `npx wrangler secret list --name halalfood-world`. Do not also set a plain var of the same name.

Do not promote a preview version manually.
