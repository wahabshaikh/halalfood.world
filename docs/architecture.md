# Architecture

How halalfood.world works: the product rules, routes, API, limits, auth, SEO and data. Environments and deploys
are in [deployment.md](deployment.md); scripts and backfills in [operations.md](operations.md); the full product design
in [spec/](spec/README.md).

## Product rules

**How a place gets verified.** People who eat somewhere answer four questions: Is it Muslim-owned? Is it halal certified? Does it serve pork? Does it serve alcohol? Each answer is Yes, No or Not sure. A fact is settled when the three most recent definite answers from different accounts agree, and a place is **Community verified** when all four facts are settled. Until then it shows "n of 3 checks" or "Not checked yet" (which never means "not halal"). A check counts the moment it is sent, a person's latest check at a place is the only one that counts, and an account must be 24 hours old before its checks count. The rules live in [`lib/core/halal.ts`](lib/core/halal.ts) and [`docs/spec/halal-model.md`](spec/halal-model.md); the full design is [`docs/spec/simplified-community-spec.md`](spec/simplified-community-spec.md).

**Everything social is context, never evidence.** Follows, the Friends feed, likes, comments, lists, recs, events, points, creator videos and creator verifications help people decide where to eat, but none of them can change a place's status. Places can only be added from a Google Maps result and go live at once, with the adder's answers as the first check. Moderators act on reports and nothing else.

**Imported places are "Unverified" until something shows they exist.** About 7.7k places were imported from halalfoodnear.me (scraped Sep 13, 2026, carried over at the Oct 5 cutover; `places.import_source = 'halalfoodnear.me'`). Until one has a counted check, an approved certificate or menu, a creator video verification, or a Scout certified claim with its source, it carries an "Unverified" chip on cards and the map card, an explainer on its page, `noindex`, and no sitemap entry. This is provenance, not a halal status: it never changes the status, and the status never depends on it ([halal model](spec/halal-model.md#provenance), [runbook](runbooks/unverified-imports.md)).

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
| `/connect` | – | Connect Claude, ChatGPT or Cursor to the public read-only member MCP endpoint. Noindex until write tools ship. |
| `/search` | – | Places, people, lists and cities. |
| `/map` | – | The map, with the same filters as Explore. |
| `/place/[id]` | – | A place: status, the four facts, actions, friends, dishes, photos, videos, notes, nearby. An unverified imported place adds the "Unverified" notice and is `noindex` ([SEO](#seo-aeo-and-geo)). |
| `/place/[id]/check` | ✓ | Check a place: the four questions, how it was, dishes, photos, a note, then Check sent. |
| `/add`, `/add/video` | search –, submit ✓ | Add a place from Google Maps; save a place from a TikTok, Reel or YouTube link. |
| `/login` | – | Email code sign-in with Turnstile. A new account goes to `/welcome`. |
| `/welcome` | ✓ | First sign-in: profile, what matters, follow a few people. |
| `/saved` | ✓ | Saved places and lists. |
| `/list/[id]` | visibility | A ranked list, a plan with friends, or a guide. |
| `/friends`, `/visit/[id]` | ✓ / visibility | The Friends feed and one visit with likes and comments. |
| `/inbox` | ✓ | Activity and Recs. |
| `/u/[handle]`, `/invite/[handle]` | visibility / – | Someone's profile; an invite landing. A creator profile adds the YouTube channel, subscribers, banner, "Verified in videos" and, while unclaimed, "Unclaimed. Is this you? Claim it". |
| `/community` | – | The points leaderboard per city, this week or all time. |
| `/events`, `/event/[id]` | – | Halal food events and their stalls. |
| `/creator/[platform]/[handle]` | – | Places from a creator's videos; links to `/u/<handle>` when the channel has a creator profile. |
| `/me`, `/me/settings`, `/me/privacy` | ✓ | You (Passport, Checks, Lists), Settings, Privacy & people. |
| `/admin` | moderator | Reports, Places (new places waiting for review), Evidence, Events and Sponsors. |
| `/how-trust-works` | – | Plain-words explainer: the four halal facts and Confirmed, place badges, trust bands and points. Linked from the footer. |
| `/newsletter` | – | City picks, new places and sponsor slots; subscribe and manage a Whop newsletter membership. |
| `/sponsor`, `/sponsor/[citySlug]`, `/sponsor/thanks` | – / form ✓ / ✓ | Sponsor a city: the offer and which cities are open; one city's form, card preview and Whop checkout; the return page after paying. |

### API

| Method & path | Purpose |
| --- | --- |
| `GET /api/places` | Explore and map: `city`, `bbox`, `near`, `filters`, `friends`, `offset`, `limit`. Every place (here, in `GET /api/places/[id]`, search, saved, lists and the feed) carries `unverified: boolean`: true for an imported place not yet verified to exist. Added Oct 2026; older clients can ignore it. |
| `POST /api/places` | Add a place from a Google result with optional answers. 409 with the id for a duplicate. Returns `{id, status}`; `status` is `unchecked`, `checking`, or (added Oct 2026) `pending` when the adder is New or Restricted tier (`lib/core/trust.ts`): the place stays `hidden` with a pending `place_add` contribution until a moderator approves it. Member tier and above list at once and their contribution is accepted. |
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
| `GET /api/admin/places`, `POST /api/admin/places/[id]` | Pending places from New and Restricted members. `{decision: "approve" \| "reject", reason?}`; a rejection needs a reason. Approve lists the place, accepts the contribution and grants its 5 points in `contribution_points` under the daily caps (`lib/core/contributions.ts`); reject keeps it hidden, revokes the points and excludes the adder's answers. Both write `audit_log`. |
| `GET /api/admin/reports`, `POST /api/admin/reports/[id]`, `GET/POST /api/admin/events`, `GET/PUT/DELETE /api/admin/events/[id]` | Moderation. Every action writes `audit_log`. |
| `POST /api/newsletter/checkout` | Signed-in newsletter checkout, JSON object body (no fields required), returns `{url}`. 503 when unconfigured; shares the sponsor checkout budget (10/day per user, 30/day per IP). |
| `GET/POST /api/sponsorships` | Mine; start a city sponsorship (`{citySlug, name, tagline?, linkUrl}`) and get the Whop `checkoutUrl`. 409 when the city is sponsored or held, 503 without Whop keys. 10 a day per person. |
| `POST /api/webhooks/whop`, `POST /api/admin/sponsorships/[id]` | Whop webhooks (signed with `WHOP_WEBHOOK_SECRET`); a moderator taking a sponsor card down or restoring it (`{action: "remove" \| "restore"}`, audited). |
| `/api/auth/*`, `POST /api/admin/email/healthcheck` | Better Auth; the optional email smoke check. |
| `POST /api/mcp` (`GET`/`DELETE` 405) | Halal Food Scout's admin MCP endpoint. Bearer `MCP_ADMIN_SECRET`; see [below](#halal-food-scout-admin-mcp). |

Every write needs a session and spends a per-user and per-IP budget (checks 20 a day, places 10, recs 30, reports 10, comments 100). Reads that show checks apply one visibility rule: unshared checks are the author's alone, nothing crosses a block, and a private account's checks show only to accepted followers. `tests/check-visibility-audit.test.ts` fails if a query over `checks` doesn't say which audience it serves.

#### Member MCP (public, read-only)

`POST /api/mcp/member` is the public member MCP endpoint (`halalfood-world`), separate from Scout.
It needs no session or admin token and exposes only `search_places` (query 1–64 characters, optional city slug,
limit 1–10, default 10) and `get_place` (place id). Both reuse the public listed-place read paths and return only
id, name, city slug, area, cuisine, halal status, the four facts and a canonical place URL. City prioritizes
results rather than filtering them. No people, check authors, emails or Google snapshots are exposed.
The transport is stateless JSON-RPC over POST; GET/DELETE return 405, bodies over 64 KB return 413 (including
streamed bodies), and all responses use `Cache-Control: no-store`. Halal status comes from community checks
and reviewed documents; bulk scraping is prohibited. Reads are limited per client IP by the `MEMBER_MCP_READ_LIMITER`
binding (60 a minute, namespaces 81004 / preview 81104); over it the endpoint answers 429.
See [member-mcp.md](member-mcp.md) for client setup.

## Halal Food Scout (admin MCP)

Halal Food Scout is a bot that finds halal food YouTube creators and records which places they verify in their
videos. It talks to `POST /api/mcp`, a [Model Context Protocol](https://modelcontextprotocol.io) server over
Streamable HTTP (JSON-RPC over POST, stateless: a fresh server per request, no sessions; `GET` and `DELETE` answer
405). It uses `@modelcontextprotocol/server` 2.0 (`createMcpHandler`), the same SDK as deen.page's MCP server. The
code is in [`lib/scout/`](../lib/scout); the pure rules in [`lib/core/creators.ts`](../lib/core/creators.ts),
[`lib/core/place-candidates.ts`](../lib/core/place-candidates.ts) and
[`lib/core/ingest-filters.ts`](../lib/core/ingest-filters.ts).

**Auth.** Every request, including `initialize` and `tools/list`, needs `Authorization: Bearer <MCP_ADMIN_SECRET>`.
The secret is a Worker secret of at least 32 characters. Unset or shorter: every request gets **503** ("the Scout
endpoint is off"), never an open endpoint. A missing or wrong token gets **401** with `WWW-Authenticate: Bearer`.
The token is compared in constant time (both sides hashed with SHA-256 first) and never logged or echoed. Bodies
over 256 KB get 413.

**Tools.** Every tool returns one text item holding JSON. Failures set `isError` and carry `{ ok: false, error, message }`.

| Tool | What it does |
| --- | --- |
| `find_place` | Read-only. Ranked candidates for `name` near `lat`/`lng` (`radius_m`, default 300, max 2000) and/or in `city`, optionally by `google_place_id`. Each has `id`, `name`, `address`, `city`, `country`, `lat`, `lng`, `distance_m`, `url`, `score`, `matched_by` and `listing_status`. |
| `upsert_creator` / `upsert_creators` | An unclaimed, claimable creator profile at `/u/<handle>` from a YouTube channel (`handle`, `channel_id`, `display_name`, `bio`, `avatar_url`, `banner_url`, `channel_url`, `subscriber_count`). |
| `upsert_place` / `upsert_places` | Match first, else list a new place (`name`, `address`, `city`, `country`, optional `lat` + `lng`, `google_place_id`, `website`, `cuisine`, `force_new`, the four [sourced attributes](#scout-attributes), and `google_types` / `description` for the filters only). Returns `location` and, when attributes were sent, `attributes`.  Coordinate repairs: `relocate`, optional `place_id`; returns `relocated` with previous/current or `relocate_refused`. |
| `add_verification` / `add_verifications` | A creator (`@handle` or channel id) showed `place_id` in a video (`video_url`, `timestamp` as `83` or `"1:23"`, `date` as an ISO date, optional `title`). |
| `remove_verification` | By `id`, or by `creator` + `place_id` + `video_url`. Removing one that isn't there returns `removed: false`. |
| `upsert_menu` / `upsert_menus` | Store a place's published menu: `place_id`, `currency` (ISO 4217, default for items), `captured_at`, 1–10 `sources` `{ url, type }`, 1–500 `items` `{ name, price, currency?, section?, description? }`. Replaces items and sources as a whole; returns `result` (`created`, `updated`, `unchanged`), counts and `captured_at`. [Menus](#scout-menus). |
| `set_menu_check` / `set_menu_checks` | Scout's read of the menu: `place_id`, `status` (`clean`, `flagged`, `no_menu`), `flags` `[{ item \| name, reason: alcohol \| pork \| other, note? }]` (flagged only), `source_url`, `checked_at`. Returns `claims` per fact and `badge`. |
| `set_place_logo` | `place_id`, `logo_url` (https, or `null` to remove) and `source_url` (the https page it was found on). Returns `set`, `updated`, `unchanged` or `cleared`. |

**Creators.** A creator is an ordinary `user` + `profiles` row plus a `creator_profiles` row (channel id, channel
handle and URL, avatar and banner URLs, subscribers, `claimed_at`). The profile handle is the YouTube handle,
lowercased without `@`; a handle our rules can't hold (hyphens, reserved words, under 3 characters) fails with
`invalid_handle` rather than becoming a different handle. The channel id is the identity: a known channel is
updated, and its profile handle follows a new YouTube handle only when that handle is free (`handle_kept`
otherwise). The `user.email` is `creator-<user id>@unclaimed.invalid`; the auth route refuses sign-in codes for any
`.invalid` address and `lib/email.ts` refuses to mail one, so nobody can sign in as an unclaimed creator. Unclaimed
creators have no `onboarded_at`, which keeps them out of people search and follow suggestions. A profile is
**claimed** when `claimed_at` is set or its user has a real email; Scout never writes to a claimed profile or to a
handle that belongs to someone who signed up (`result: "claimed"`), and refuses verifications for them
(`creator_claimed`). Avatars and banners are stored as external URLs and rendered as-is, never fetched: only https
URLs on YouTube's image hosts (`yt3.ggpht.com`, `yt3.googleusercontent.com`, `i.ytimg.com`,
`lh3.googleusercontent.com`) are kept. Claiming is a follow-up: today "Claim it" opens an email to
`salam@halalfood.world`, and a moderator sets `claimed_at` and the real email by hand.

**Places.** Candidates come from one query: places whose name contains one of the query's distinctive words
(`instr()`, never `LIKE`: D1 caps LIKE patterns at 50 bytes) inside the radius's bounding box or in the same city.
They are scored by name similarity with either distance or city plus street address (older rows may have
approximate coordinates). At a score of 0.85 or more a candidate is the same place: `upsert_place` returns
`result: "matched"` and fills that place's empty columns (country, city, coordinates, website, Google id), with guarded Scout coordinate repairs described below. A
shared name in the same city without a matching street is never enough (chains). New places go live at once as Not
checked yet, the same as a person adding one from Google Maps (#58's hold-for-review was retired in the four-fact
redesign); they have no submitter, no points and no check.

A match needs a name similarity of at least 0.8 however close the two are: location and street address add at most
0.25 on top of `0.75 × name`. One name *starting with* the other is a branch suffix and scores 0.9 ("Slam Burger" →
"Slamburger Halal Luton"); a name that only *contains* or *ends with* the other scores on shared words instead. That
keeps a stall named after its host venue ("Oklahoma Burgers - Kingsbridge Food Hall") from matching the venue
("Kingsbridge Food Hall"), which used to score 0.93.

**`force_new`.** `force_new: true` (per item in `upsert_places`) skips matching and always lists a new place, for the
cases the ranking still gets wrong. It can't create a second row with the same city, name and street address (the
`places_city_name_address_unique_idx` index) or an already-listed Google id: that returns
`{ ok: false, error: "duplicate_place", existing_place_id }` rather than a 500 or a silent match. Change the name or
address, or use `existing_place_id`.

**Coordinates.** `lat` and `lng` are optional but must be sent together. Without explicit coordinates,
[`hasStreetAddress`](../lib/core/geocode-confidence.ts) requires a house number (1–4 digits, optional letter)
with a remaining word of at least four letters, or a street word beyond the city, country and postcode.
UK, Dutch, 5–6 digit and common country-specific four-digit postcodes are stripped. The conservative vocabulary includes street/st,
road/rd, avenue/ave, lane/ln, drive/dr, boulevard/blvd, way, rue, strasse, calle, jalan and marg.
Other numberless addresses can be false negatives: send confirmed coordinates instead. City-only inputs return
`location: "null", geocode: "no_street_address"` without a Google call or budget reservation.

Otherwise [`lib/scout/geocode.ts`](../lib/scout/geocode.ts) uses the existing Google key and daily caps.
A `google_place_id` uses Place Details (`formattedAddress,location,types,addressComponents`, `details:` cap); otherwise the address,
city and country use Text Search (`places.id,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents`,
search cap). Each request reserves one unit first. Types and address components keep Details at Essentials and Text Search at its
existing Pro tier (Text Search formattedAddress/types already require Pro); no contact/hours/Enterprise fields are requested
([Google field/SKU table](https://developers.google.com/maps/documentation/places/web-service/data-fields), checked 2026-10-18).
The top usable result must have types with venue/street precision. Any locality, sublocality*, administrative_area_level_*,
postal_code*, postal_town, country, political, colloquial_area or neighborhood type rejects it as `not_street_level`.
All route results are rejected, even with a number in the formatted address: a road centre is not a venue pin.
Missing/empty types and generic point_of_interest/geocode alone also fail. Street_address, premise,
establishment and venue types (such as restaurant) qualify. The existing checks still apply: valid coordinates,
no other usable result more than 1 km away, a matching city, and a matching country when supplied.
City matching accepts any locality, postal_town, administrative_area_level_1–3, sublocality*, neighborhood or
colloquial_area component's longText/shortText (case/accents ignored; City, -ku, -shi and Ward suffixes stripped;
Tokyo aliases 東京/東京都), or the existing whole-word formatted-address match. A result within **40 km** of the
city centre in `lib/data/city_coords.json` also qualifies, using the same `slugifyCity(city)` key as Scout's city
slug. This deliberately includes nearby metro districts such as Don Mills and Edgware; nearby separate municipalities
can qualify too. Unknown centres require a text/component match. The centre is only a trust check, never a returned pin.
Country matching uses the country component's ISO alpha-2 shortText or longText, English ISO region names via
`Intl.DisplayNames`, and common aliases (including Japan/JP/日本). Explicit alias groups remain a fallback if Intl
region names are unavailable. Without a country component, all comma, Japanese-comma and hyphen address
parts are checked, supporting both country-first Japanese and country-last Western addresses. A mismatching country
component cannot be overridden by formatted text or proximity.

Failures on new/unlocated places store null coordinates: listed in city/search, without map pin, distance or Nearby,
with name/address Directions and "Location pending". Reasons are `no_street_address`, `not_street_level`,
`not_configured`, `budget_exhausted`, `provider_error`, `no_result`, `ambiguous`, `wrong_city`, `wrong_country`.
Failures when correcting a located place keep its pin and return `existing` with the failure reason.
A confirmed street address can still be saved independently of geocoding for Scout/geocoded sources, wholly null
coordinates with unknown source, or an explicitly relocated legacy unknown-source place with Scout creation proof
(as below). Protected sources' addresses are never overwritten, even with null coordinates. An address repair
returns `address_updated: true`, `address_change: {previous, current}` and `filled` including `street_address`;
it bumps the listing cache version. With no pin or Google id, Directions becomes a name/address search. Existing
pins and Google-id Directions stay intact. Duplicate city/name/street addresses return
`address_refused: "duplicate_place"`; concurrent location/address changes return `address_refused: "location_changed"`.
These refusals do not fail the whole upsert or erase coordinates.

`places.location_source` records `scout` (explicit Scout coordinates), `geocoded` (Scout server geocode),
`google` (Google add-a-place), or `import` (seed/coordinate backfills). `community` and `listing` are valid protected
sources reserved for coordinate writers: current community/owner/moderator edits and listing-signal imports do not
write coordinates. Migration 0006 only adds the nullable column, with **no backfill**: all old rows remain NULL
(unknown/protected), since no-submitter rows include imports.

On match, a wholly absent coordinate pair can be filled. Partial protected pairs keep their existing coordinate. Existing `scout`/`geocoded` pins can be corrected with explicit
coordinates or a street address that passes geocode confidence. An explicit Scout pin whose stored address is already
street-level requires `relocate: true` before replacing it with a geocode; a fresh geocode alone cannot prove it more
precise. `relocate: true` (also per item in `upsert_places`) overrides that comparison, never confidence or protected
sources. `community`, `google`, `import`, `listing` and unknown sources stay protected. The sole legacy exception:
explicit relocation of an unknown-source, no-submitter place with a Scout **creation** audit (`mcp:scout`,
`listing.changed`, target `listing/directory`, JSON `change: place-added`, `placeId` equal to this place).
Claims/verifications do not prove creation. Missing audit means protected. A conditional write checks the old pin
and source again, so a concurrent change wins. Corrections update the street address when street-level, preserve
`city_slug`/URL refresh coordinate Directions links and bump the listing cache version.

Results use `location: provided | geocoded | existing | null | relocated`. `relocated` includes `previous` and
`current` (`{lat, lng, source}`); refused corrections return `existing` and `relocate_refused` (`protected_source`,
`no_street_address`, `not_more_precise`, `location_changed`, or the geocode failure).
For a precise repair when the new address would defeat normal matching, send `place_id` (existing UUID) with
`relocate: true`, without `force_new`; an unknown id fails instead of creating a row. Normal matching is unchanged.
See the [candidate SQL and repair runbook](runbooks/scout-relocate.md).

<a id="scout-attributes"></a>**Attributes.** `upsert_place` takes four optional sourced attributes, each
`{ value: "yes" | "no" | "unknown", source_url }` (`source_url` an https URL, required for yes and no):
`halal_certified` (plus `certifier_name`, only with yes), `muslim_owned`, `no_pork` and `no_alcohol`. They map onto
the four facts: `halal_certified` → `certified`, `muslim_owned` → `owned`, `no_pork: yes` → `pork = no` (and no → yes),
`no_alcohol: yes` → `alcohol = no` (and no → yes). Each is stored as a web claim in `place_claims` (source `scout`, one
row per place and fact, with its URL, certifier and date), the same kind of evidence as a map listing: it fills a
fact's value only when no community check or approved document answers it, never settles a fact and never moves a
place off Not checked yet ([halal model](spec/halal-model.md)). The merge rule (`planClaim` in
[`lib/core/place-claims.ts`](../lib/core/place-claims.ts)), per fact, on create and on match:

| Sent | Outcome in `attributes` |
| --- | --- |
| left out | nothing changes, not listed |
| `unknown` | `cleared` when Scout had a claim for that fact (it is deleted), else `unchanged`. Never stored, never stored as "no". |
| yes/no while community checks or an approved certificate or menu answer the fact (or it is disputed) | `kept_existing`: nothing is written |
| yes/no otherwise | `set` (no Scout claim before), `updated` (replaces Scout's older claim: newer wins), `unchanged` (same value, URL and certifier) |

A map listing is not protected: a claim that cites a page outranks it. Moderators set no halal facts on places
directly (fix-details edits name, address, phone and website), so checks and reviewed documents are the only values
Scout must not override. Every write recomputes `place_status` with `recomputePlaceStatus`, so the filter chips
(Halal certified, Muslim-owned, No pork, No alcohol) follow, and a moderator merge moves claims to the kept place.
The place page links "Web source" on each fact a claim backs, with the certifier. `no_alcohol: no` (serves alcohol)
doesn't refuse a restaurant: serving alcohol is a fact, and only alcohol-led places (pubs, bars, …) are refused, by
name and types.

<a id="scout-menus"></a>**Menus, menu checks and logos.** Code: [`lib/scout/menus.ts`](../lib/scout/menus.ts) (tools),
[`lib/core/menus.ts`](../lib/core/menus.ts) (validation, grouping, the menu check rule), [`lib/menus.ts`](../lib/menus.ts)
(the place page read). Tables from [`0008_menus.sql`](../migrations/0008_menus.sql): `place_menus` (one per place,
`captured_at`, source `scout`), `place_menu_items` (`position`, `section`, `name`, `description`, `price` in the
currency's major unit, `currency`), `place_menu_sources` (`url`, `type`), `place_menu_checks` (one per place,
`status`, `source_url`, `checked_at`) and `place_menu_check_flags` (`item_name`, optional `item_id`, `reason`, `note`),
plus `places.logo_url` / `places.logo_source_url`.

- Places resolve as for `add_verification`: a valid id of a listed place that isn't alcohol-led or Ahmadiyya
  (`invalid_place_id`, `place_not_found`, `place_not_listed`, `rejected`).
- `upsert_menu` validates at the boundary (zod) and again in `normalizeMenu`: prices are numbers ≥ 0 (up to 10
  million, rounded to 3 decimals), currencies are three capital letters that `Intl.supportedValuesOf("currency")`
  knows, every item has a currency (its own or the menu's), at most 500 items and 10 sources, source URLs are https
  (http is refused) without credentials, and repeated source URLs collapse. The replacement (upsert the menu row,
  delete items and sources, insert the new ones 12 rows per statement to stay under D1's 100 bound parameters) is one
  D1 batch, so readers never see half a menu. The same menu again is `unchanged` and only moves `captured_at`
  forward. Replacing a menu unlinks flags from the old item rows (`item_id` goes null); `item_name` stays.
- `set_menu_check`: `flagged` needs at least one flag and the other statuses none. A flag's `item` must name an item
  on the stored menu (matched without case), else `unknown_item`; `name` is for anything else (a wine list). The rule
  is in the [halal model](spec/halal-model.md#published-menus-and-the-menu-check): `clean` only shows the badge and
  writes no claim; `flagged` alcohol/pork flags go through `applyClaims` as `no_alcohol: no` / `no_pork: no` with
  `source_url` (default: the menu's first source; with neither, `missing_source`), so they get the
  [attribute](#scout-attributes) outcomes (`set`, `updated`, `unchanged`, `kept_existing`) in `claims`, recompute
  `place_status` and refresh listings when they wrote anything. `no_menu` writes nothing else.
- `set_place_logo` stores an external https URL. The place page shows it beside the name and cards show it when the
  place has no photo, as a plain `<img>` with `referrerPolicy="no-referrer"` and `loading="lazy"`; it is never
  fetched or proxied. `httpsLogoUrl` checks it again on read and at render, and a `CHECK` keeps non-https values out
  of the column. Cards read it, so a change refreshes listings.
- The place page groups items by section (in menu order) with `Intl.NumberFormat` prices, shows the first 10 and
  folds the rest behind "Show all n items" (`<details>`), and cites each source and the read date.
- A moderator merge moves the menu, menu check (with items, sources and flags, by `ON UPDATE CASCADE`) and logo to
  the kept place unless it has its own. Rollback for the schema: [`scripts/rollback/0008_menus_down.sql`](../scripts/rollback/0008_menus_down.sql),
  only before or together with reverting the code; wrangler ignores that folder.

**Ingest filters.** `upsert_place` refuses, and `add_verification` refuses for an existing place that fails:
Ahmadiyya places (Ahmadiyya, Qadiani, Lahori Ahmadiyya, Baitul Futuh, Jalsa Salana, …; "Ahmadi" only beside a
community word such as Muslim, Jamaat or mosque, because it is also a common surname) and alcohol-led places (the
same `hiddenListingReason` rule that hides pubs, bars, breweries and wine bars). The answer is
`{ ok: false, error: "rejected", rejected: "ahmadiyya" | "alcohol_led", reason }`.

**Verifications are context, not evidence.** `creator_verifications` holds one row per creator, place and video
(a unique index makes `add_verification` idempotent). Adding one also adds the video to `place_media_links` (unless
a person linked it already), so the place's Videos and the creator page show it; removing one deletes only the link
it added. The place page shows "Verified by <creator> in a video" under **From creators** and the profile shows
**Verified in videos**. Neither touches checks, `place_signals` or `place_status` (AGENTS.md rule 4,
[halal model](spec/halal-model.md)). A moderator merge moves verifications to the kept place. A verification does
show the place exists, so adding or removing one recomputes an imported place's "Unverified" label
([provenance](spec/halal-model.md#provenance)), as does a `halal_certified: yes` attribute with its source URL.

**Volume and limits.** Batch tools take at most 25 items and run 5 at a time; items that share a key (channel or
handle; city or Google id; creator) run one after another, so a batch can't duplicate itself. Each item returns in
input order with an `index`, plus a `summary` count. Writes spend the Workers Rate Limiting binding
`MCP_WRITE_LIMITER` (300 per 60 s per token, keyed `mcp-write:<first 16 hex of the token's SHA-256>`), one unit per
item; items over it come back `rate_limited`. The binding counts per Cloudflare location, so it guards against a
runaway bot rather than enforcing an exact quota. `find_place` is not rate limited. Without the binding (unit tests,
`pnpm dev`) writes are not limited.

**Connecting a client.** With [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), keeping the secret in an
environment variable rather than the config file:

```json
{
  "mcpServers": {
    "halalfood-scout": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://halalfood.world/api/mcp", "--header", "Authorization: Bearer ${MCP_ADMIN_SECRET}"],
      "env": { "MCP_ADMIN_SECRET": "<from your secret store>" }
    }
  }
}
```

Some clients split arguments on spaces; mcp-remote's documented workaround is no space after the colon and the
whole value in the variable: `"--header", "Authorization:${AUTH_HEADER}"` with `"AUTH_HEADER": "Bearer <secret>"`.
Locally, put `MCP_ADMIN_SECRET` in `.dev.vars` and use `http://127.0.0.1:5173/api/mcp` (add `--allow-http`). A
quick check without a client:

```sh
curl -s https://halalfood.world/api/mcp -H "Authorization: Bearer $MCP_ADMIN_SECRET" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## City sponsorships (Whop)

One sponsor per city at a time, $49 every 30 days, sold through [Whop](https://whop.com). Rules in
[`lib/core/sponsorship.ts`](../lib/core/sponsorship.ts), D1 in [`lib/sponsorships.ts`](../lib/sponsorships.ts), Whop calls in
[`lib/whop.ts`](../lib/whop.ts), tables `city_sponsorships` and `whop_webhook_events` (`migrations/0009_whop.sql`).

1. A signed-in buyer writes a card (name ≤ 60, one line ≤ 120, an https link) on `/sponsor/[citySlug]`. `POST /api/sponsorships`
   stores a `pending` row, which holds the city for an hour, and creates a Whop checkout configuration with an inline monthly
   hidden plan with `account_id` and optional `WHOP_SPONSOR_PRODUCT_ID`, and metadata `{kind: "sponsorship", sponsorship_id}`. The browser goes to Whop's `purchase_url`; Whop returns it to `/sponsor/thanks?id=`.
2. Whop's `payment.succeeded` webhook makes the row `active` for 30 days from the payment (or from the end of another paid
   sponsor's window in the same city, so two cards never show at once). Each renewal payment extends it by 30 days.
   `membership.updated`, `membership.deactivated` and `membership.cancel_at_period_end_changed` stop renewal when canceled, completed, expired, unresolved or set to cancel at period end. Active/trialing memberships with cancellation disabled resume renewal on active rows. The card stays up until the paid window ends. A succeeded refund
   (`refund.created`/`refund.updated`) sets `refunded` and hides it at once.
3. Webhooks are verified (Standard Webhooks HMAC-SHA256, keyed with the literal `ws_…` secret, 5-minute tolerance) and
   deduplicated by `webhook-id`. Unknown sponsorships are recorded and answered 200 so Whop stops retrying.
4. The live card (`status = 'active'`, `starts_at <= now < active_until`) shows on `/city/[slug]` after Guides & lists and
   before the places. Moderators can take one down from `/admin` → Sponsors; refunds are issued in Whop.

The card never touches checks, status, filters or ordering (spec §1 rule 9). Deleting the buyer's account keeps the paid
sponsorship with `user_id` set to NULL. Whop holds the buyer's billing details; D1 stores only Whop ids.

## Newsletter (Whop)

`/newsletter` offers city picks, new places and sponsor slots. Subscriptions never affect halal status or rankings.
`POST /api/newsletter/checkout` requires a session, validates a JSON object, spends the checkout budget and creates a
checkout with `plan_id` and metadata `{kind: "newsletter", user_id}`. The browser returns to `/newsletter` after Whop.
`WHOP_API_KEY` and `WHOP_NEWSLETTER_PLAN_ID` enable checkout; without them the page
says "Not available yet" and the API returns a user-facing 503. `WHOP_NEWSLETTER_PRODUCT_ID` enables product matching and live access confirmation. Billing and newsletter delivery are managed in Whop.

The shared signed webhook dispatches `membership.activated`, `membership.updated`, `membership.deactivated` and
`membership.cancel_at_period_end_changed` to both membership handlers. Newsletter events are recognized by
`metadata.kind` or the configured product/plan id. `payment.succeeded` with newsletter metadata is ignored by sponsorships.
`whop_memberships` in `0009_whop.sql` stores provider ids, status, cancellation, period end, a Whop manage link and
the provider event time. Upserts ignore older/equal events, preserving account ownership when updates omit metadata.
Account deletion sets the local user reference to NULL. Unknown local accounts are stored without a local reference.
One `whop_webhook_events` row per delivery is recorded only after both handlers succeed; newsletter upserts are safe
if a delivery retries after a partial failure. The migration uses `IF NOT EXISTS` because the shared Preview D1
already has sponsorship tables from the branch's original `0007_city_sponsorships.sql`; 0007/0008 are reserved by other PRs.

`lib/core/newsletter.ts` grants access for `active`, `trialing`, `canceling` and `past_due`. `lib/newsletter.ts` reads the
account's memberships, then confirms access via `GET /api/v1/users/{user_id}/access/{product_id}` when the Whop user,
API key and configured product are known. The call has a three-second timeout; errors fall back to the stored status.
Subscribed readers see "You're subscribed" and their Whop management link when supplied by the provider.

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

The schema is one baseline, [`migrations/0001_baseline.sql`](../migrations/0001_baseline.sql) (D1/SQLite: `text` ids, Unix-millisecond timestamps, `0`/`1` booleans, JSON arrays as text). It creates the Better Auth tables, the OTP limiter, places with their `place_status` projection, checks, people, social, lists, events, recs, notifications, points and reports. Later migrations add `place_signals` (0002), the email sink (0003), `creator_profiles` / `creator_verifications` (0004, Halal Food Scout), `place_claims` (0005, Scout's sourced web claims), `places.location_source` (0006) and `places.import_source` / `places.import_verified_at` with the `places_indexable_idx` partial index (0007, imported-place provenance; its operator-only rollback is `scripts/rollback/0007_place_provenance_down.sql`, outside `migrations/` so no deploy runs it), the menu tables and logo columns (0008, Scout menus), the Whop sponsorship tables (0009) and the community trust tables `contributions`, `vouches`, `member_trust` and `contribution_points` with the `place_status` trust columns (0010; rules in `lib/core/trust.ts` and `lib/core/contributions.ts`, nothing reads or writes them yet). `lib/db/schema.ts` mirrors it. The app is live. Production moved to this baseline on Oct 5, 2026 by cutting over to a new D1 database, `halalfood-world-v2`; the pre-cutover database `halalfood-world` is kept untouched for rollback ([runbooks/d1-cutover-rollback.md](runbooks/d1-cutover-rollback.md)). From here on, schema changes are new numbered, additive migrations; `pnpm cf:deploy` applies them right before each production deploy. Never drop or reset the production database.

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
- Unverified imported places (`import_source IS NOT NULL AND import_verified_at IS NULL`, `UNVERIFIED_SQL` in `lib/place-view.ts`) are kept out of search until verified: the page sets `robots: noindex, follow`, the Worker adds `X-Robots-Tag: noindex` (`lib/robots-header.ts`, one primary-key read in parallel with the render), JSON-LD carries the same "Unverified" wording as the page, and the place sitemap leaves them out. City pages still list them; their pages are linked and followed, just not indexed.

### Sitemap strategy

`/sitemap.xml` is a **sitemap index**, not a urlset. ~12k places and a few hundred cities would fit in one file, but that would mean one large query per crawl and a full re-fetch whenever any row changes. The index points at:

| Child | Contents |
| --- | --- |
| `/sitemaps/core/sitemap.xml` | Home, the city directory, events, community, How trust works, Sponsor a city and Newsletter. |
| `/sitemaps/cities/sitemap.xml` | One entry per distinct `city_slug`, capped at 2,000. |
| `/sitemaps/places/sitemap/N.xml` | Indexable places (`INDEXABLE` in `lib/place-view.ts`: listed, and not an unverified import), 5,000 per file, from an id-ordered scan on `places_indexable_idx` so chunk boundaries stay stable. |
| `/sitemaps/social/sitemap.xml` | Public lists, public profiles with a shared check, and upcoming events. |

`robots.txt` disallows `/api/`, `/search` and the signed-in screens (`/me`, `/saved`, `/inbox`, `/friends`, `/admin`, `/welcome`, `/add`, `/login`). Place, city, list and profile pages render the viewer's saves and friends on the server, so only `/cities` and the sitemaps are cached at the edge.

When an imported place is verified (or loses its last evidence), `recomputePlaceVerification` publishes a listing change, which moves cached listing reads to a new key and purges the `sitemaps` cache tag. Without that purge the place still appears within the existing lifetimes: the place sitemap read is cached for 6 hours, the count for 1 hour, and the documents for `s-maxage` 6 hours (plus `stale-while-revalidate`). Place pages are never edge-cached, so their `noindex` follows the data on the next request.

`MAX_PLACE_CHUNKS` in `lib/sitemap.ts` caps the index at 50 chunks if the table ever grows far beyond its current size. If the count query fails, the index still advertises the core and city sitemaps rather than returning nothing.

## Data and bounded APIs

- Every list endpoint is limit-clamped and parameterized; search uses literal `instr()` matching and caps `q` at 64 characters. Place search splits a leading or trailing known city using the cached city directory, then ANDs up to four words across searchable fields (under 100 bound parameters).
- Status is computed in TypeScript and written to `place_status` in the same D1 batch as the check, so Explore, the map and search filter with plain SQL. Filters match the fact's current value, settled or not; Confirmed (`verified`) needs all four settled.
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
