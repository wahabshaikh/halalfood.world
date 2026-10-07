# Architecture

How halalfood.world works: the product rules, routes, API, limits, auth, SEO and data. Environments and deploys
are in [deployment.md](deployment.md); scripts and backfills in [operations.md](operations.md); the full product design
in [spec/](spec/README.md).

## Product rules

**How a place gets verified.** People who eat somewhere answer four questions: Is it Muslim-owned? Is it halal certified? Does it serve pork? Does it serve alcohol? Each answer is Yes, No or Not sure. A fact is settled when the three most recent definite answers from different accounts agree, and a place is **Community verified** when all four facts are settled. Until then it shows "n of 3 checks" or "Not checked yet" (which never means "not halal"). A check counts the moment it is sent, a person's latest check at a place is the only one that counts, and an account must be 24 hours old before its checks count. The rules live in [`lib/core/halal.ts`](lib/core/halal.ts) and [`docs/spec/halal-model.md`](spec/halal-model.md); the full design is [`docs/spec/simplified-community-spec.md`](spec/simplified-community-spec.md).

**Everything social is context, never evidence.** Follows, the Friends feed, likes, comments, lists, recs, events, points and creator videos help people decide where to eat, but none of them can change a place's status. Places can only be added from a Google Maps result and go live at once, with the adder's answers as the first check. Moderators act on reports and nothing else.

## Styling and icons

**Styling.** Pages are composed from shadcn/ui components; there is no hand-written stylesheet. Colours, radii and fonts are theme tokens in `app/globals.css` (primary is the tandoor orange, plus `success`, `warning` and `info` tokens used for halal status tones), and layout uses Tailwind utilities on those components. App-level building blocks shared by several pages live in `components/hf` (`kit` for buttons, pills, meters and art; `kit-client` for sheets, toasts and the save heart; `app-shell` and `nav-tabs` for the five-tab frame). To add a shadcn component (it lands in `components/ui`):

```sh
pnpm dlx shadcn@latest add <component>
```

**Icons** come from Hugeicons: `import { HugeiconsIcon } from "@hugeicons/react"` with an icon from `@hugeicons/core-free-icons`.

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

## Sign-in, Turnstile and limits

The `/login` page renders a Cloudflare Turnstile widget, then uses the Better Auth `emailOTP` plugin to request and verify a 6-digit sign-in code. The client uses `emailOTPClient`; successful verification creates a database-backed Better Auth session and secure, HTTP-only cookie. OTP mail is sent only through `lib/email.ts` (Cloudflare Email Service, from `EMAIL_FROM`), with both text and HTML bodies. On localhost and Worker Previews it goes to the email sink instead (see [testing.md](testing.md)).

Turnstile is fail closed in production: the request endpoint returns an error when either `TURNSTILE_SITE_KEY` or `TURNSTILE_SECRET_KEY` is missing, when no token is supplied, or when Cloudflare rejects the token. The site key is rendered to the browser but stored as a Worker secret (a plain var of the same name would replace it). Localhost and Worker Previews always use Cloudflare's always-pass test keys (`lib/worker-env.ts`), decided by `lib/environment.ts`; `halalfood.world` and the production Worker's own workers.dev URLs always use the production keys.

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

The limiter fails closed if D1 is unavailable, so a provider outage cannot turn the endpoint into an unrestricted mail sender. Old limiter rows can be pruned by Ops after confirming the retention policy; they contain hashes rather than raw identifiers.

## Schema

The schema is one baseline, [`migrations/0001_baseline.sql`](../migrations/0001_baseline.sql) (D1/SQLite: `text` ids, Unix-millisecond timestamps, `0`/`1` booleans, JSON arrays as text). It creates the Better Auth tables, the OTP limiter, places with their `place_status` projection, checks, people, social, lists, events, recs, notifications, points and reports. `lib/db/schema.ts` mirrors it. The app is live. Production moved to this baseline on Oct 5, 2026 by cutting over to a new D1 database, `halalfood-world-v2`; the pre-cutover database `halalfood-world` is kept untouched for rollback ([runbooks/d1-cutover-rollback.md](runbooks/d1-cutover-rollback.md)). From here on, schema changes are new numbered, additive migrations; `pnpm cf:deploy` applies them right before each production deploy. Never drop or reset the production database.

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
- `lib/seo.ts` holds the pure title/description/JSON-LD helpers and is unit-tested in `lib/seo.test.ts`.

### Sitemap strategy

`/sitemap.xml` is a **sitemap index**, not a urlset. ~12k places and a few hundred cities would fit in one file, but that would mean one large query per crawl and a full re-fetch whenever any row changes. The index points at:

| Child | Contents |
| --- | --- |
| `/sitemaps/core/sitemap.xml` | Home, the city directory, events and community. |
| `/sitemaps/cities/sitemap.xml` | One entry per distinct `city_slug`, capped at 2,000. |
| `/sitemaps/places/sitemap/N.xml` | Places, 5,000 per file, from an id-ordered scan so chunk boundaries stay stable. |
| `/sitemaps/social/sitemap.xml` | Public lists, public profiles with a shared check, and upcoming events. |

`robots.txt` disallows `/api/`, `/search` and the signed-in screens (`/me`, `/saved`, `/inbox`, `/friends`, `/admin`, `/welcome`, `/add`, `/login`). Place, city, list and profile pages render the viewer's saves and friends on the server, so only `/cities` and the sitemaps are cached at the edge.

`MAX_PLACE_CHUNKS` in `lib/sitemap.ts` caps the index at 50 chunks if the table ever grows far beyond its current size. If the count query fails, the index still advertises the core and city sitemaps rather than returning nothing.

## Data and bounded APIs

- Every list endpoint is limit-clamped and parameterized; search escapes wildcard characters and caps `q` at 64 characters.
- Status is computed in TypeScript and written to `place_status` in the same D1 batch as the check, so Explore, the map and search filter with plain SQL. Filters match the fact's current value, settled or not; Verified needs all four settled.
- A status flip writes `place_status_changes` and tells everyone who saved the place.
- Points (3 a check, 5 for adding a place, 10 for helping verify one) are an append-only ledger with one award per kind, place and person per day. They rank the Community board and never touch status.
- Coordinates come from Google Places when a place is added; older rows may carry approximate city-centre coordinates until backfilled.
- API failures return generic errors without database details or credentials.

## R2 photos

The web app's [`wrangler.jsonc`](../wrangler.jsonc) declares the `HALAL_EVIDENCE_R2` binding and the bucket `halalfood-world-evidence`.

```sh
pnpm exec wrangler r2 bucket create halalfood-world-evidence
```

Place photos and profile photos are uploaded straight to the Worker (multipart, JPEG, PNG or WebP, 8 MB for places and 2 MB for profiles), checked by content type and file signature, and stored under account-hashed keys (`photos/…`, `avatars/…`). They are served through `GET /api/photos/[...key]` and `GET /api/avatars/[handle]`. Deleting an account deletes its photos.
