# Simplified + Community: implementation spec

**Status:** Ready to build · **Date:** 5 Oct 2026
**Design:** [halalfood.world — Simplified + Community](https://claude.ai/artifact/PXfNW3f6pcNd3zmj73GjTd) (37 screens and a "What changed" page). The design is the source of truth for layout, copy and interaction. This spec covers the data, rules, APIs and build order behind it.

The app has not launched, so this is a rebuild in place:

- **No backwards compatibility.** Existing migrations, tables, routes and APIs that the new design doesn't use are deleted, not deprecated.
- **No redirects.** Removed URLs return 404.
- **No data migration** for user-generated content. The database is recreated from a new baseline schema. The only data carried over is the `places` listing rows (see [§4.4](#44-reset-and-seed)).

---

## Contents

1. [Product rules](#1-product-rules)
2. [Halal status: the algorithm](#2-halal-status-the-algorithm)
3. [Information architecture](#3-information-architecture)
4. [Data model](#4-data-model)
5. [API](#5-api)
6. [Screens](#6-screens)
7. [Design system](#7-design-system)
8. [Notifications](#8-notifications)
9. [Privacy, safety and abuse](#9-privacy-safety-and-abuse)
10. [Points and leaderboard](#10-points-and-leaderboard)
11. [SEO](#11-seo)
12. [What to delete](#12-what-to-delete)
13. [Testing](#13-testing)
14. [Build order](#14-build-order)
15. [Decisions taken in this spec](#15-decisions-taken-in-this-spec)

---

## 1. Product rules

These are the rules the code must enforce. Each one gets a test (see [§13](#13-testing)).

1. **Four halal facts, nothing else.** `owned` (Muslim-owned), `certified` (Halal certified), `pork` (Serves pork), `alcohol` (Serves alcohol). Each answer is `yes`, `no` or `unsure`, or blank if skipped.
2. **Three people verify a fact.** A fact is *settled* when the 3 most recent definite answers (`yes`/`no`) from eligible accounts all agree.
3. **A place is Community verified when all 4 facts are settled.** Otherwise it shows "*n* of 3 checks" (if anyone has checked it) or "Not checked yet".
4. **A check counts the moment it's sent.** No moderator approval. A person's latest check at a place is the only one that counts toward status. Earlier checks stay as visit history.
5. **Social is context, never evidence.** Likes, follows, lists, recs, RSVPs, points, videos, "How was it?" verdicts and dishes never affect status.
6. **"Not checked yet" never means "not halal".** This line appears once, in the How verification works sheet.
7. **New places go live at once.** Places can only be added from a Google Maps result. The adder's answers count as check 1.
8. **Reports are the safety net.** Moderators act on reports and nothing else.
9. **Nobody can pay to change a status or a ranking.** There are no sponsored placements.

---

## 2. Halal status: the algorithm

### 2.1 Eligible checks

A check is **eligible** when all of these hold:

- Its author's account has a verified email (OTP sign-in guarantees this) and was created at least 24 hours before the check.
- It is the author's **latest** check at that place.
- It is not `excluded` (moderators set this when they reset a place, see [§6.21](#621-moderation--admin)).
- The author is not suspended.

### 2.2 Per-fact state

For each place and fact, take the eligible checks that answered that fact with `yes` or `no`, newest first by `created_at`.

- `value` = the newest definite answer (`yes` | `no`), or `null` if there are none.
- `streak` = how many of the newest answers in a row equal `value`, capped at 3.
- `settled` = `streak === 3`.

`unsure` and blank answers are skipped. They never break a streak.

```ts
// packages/core/src/halal.ts
export type Answer = "yes" | "no" | "unsure" | null;
export const FACTS = ["owned", "certified", "pork", "alcohol"] as const;
export type Fact = (typeof FACTS)[number];

export type FactState = { value: "yes" | "no" | null; streak: 0 | 1 | 2 | 3; settled: boolean };

export function factState(answersNewestFirst: Answer[]): FactState {
  const definite = answersNewestFirst.filter((a): a is "yes" | "no" => a === "yes" || a === "no");
  if (!definite.length) return { value: null, streak: 0, settled: false };
  const value = definite[0];
  let streak = 0;
  for (const a of definite) { if (a !== value || streak === 3) break; streak++; }
  return { value, streak: streak as 1 | 2 | 3, settled: streak === 3 };
}
```

### 2.3 Place status

```ts
export type PlaceStatus =
  | { kind: "verified" }                         // all 4 facts settled
  | { kind: "checking"; progress: 1 | 2 }        // at least one eligible check
  | { kind: "unchecked" };                       // no eligible checks

export function placeStatus(facts: Record<Fact, FactState>, eligibleCheckCount: number): PlaceStatus;
```

- `verified` when every fact is settled.
- Otherwise, if `eligibleCheckCount > 0`, it is `checking` with `progress` = the **lowest streak among facts that have a value**, clamped to 1–2. A fact with no definite answer yet doesn't lower progress, but it still blocks `verified`. The place page lists such facts as "Not known yet".
- Otherwise `unchecked`.

Display labels: `verified` → "✓ Community verified"; `checking` → "{progress} of 3 checks"; `unchecked` → "Not checked yet".

### 2.4 Favourable values

Each fact has a favourable value, used for colour and filters:

| Fact | Favourable | Unfavourable colour | Filter chip |
| --- | --- | --- | --- |
| owned | yes | neutral grey ("No") | Muslim-owned → `value = yes` |
| certified | yes | neutral grey ("No") | Halal certified → `value = yes` |
| pork | no ("Not served") | red ("Served") | No pork → `value = no` |
| alcohol | no ("Not served") | red ("Served") | No alcohol → `value = no` |

**Filters match on `value`, settled or not.** A place where the only answer is unknown is left out, never assumed. The "Verified" chip requires `status = verified`.

### 2.5 Projection

Status is computed in TypeScript (the functions above) and written to the `place_status` table ([§4.2](#42-tables)) inside the same D1 batch as the check write. Discovery and search filter on `place_status` with plain SQL. The derivation lives in one place only, so the old TypeScript/SQL drift risk goes away.

Recompute triggers: a check is created, a check is excluded or restored, a place is merged, or an account becomes eligible. The last one is handled by a scheduled job that recomputes places checked in the last 25 hours by accounts that have just turned 24 hours old. Use the Worker cron trigger, hourly.

When the recompute changes `status.kind` or flips a settled fact's value, append a `place_status_changes` row and fan out a `status-changed` notification ([§8](#8-notifications)).

---

## 3. Information architecture

### 3.1 Navigation

The bottom tab bar on mobile has five tabs:

| Tab | Route | Signed out |
| --- | --- | --- |
| Explore | `/` | Works |
| Friends | `/friends` | Sign-in prompt |
| Add | `/add` | Search works; Add goes to sign-in |
| Saved | `/saved` | Sign-in prompt (design: "Saved — signed out") |
| You | `/me` | Goes to `/login` |

A dot on the Friends tab shows when the Inbox has unread items. On ≥ 768 px the tab bar becomes a top bar with the logo on the left, the same five items, and the Inbox bell. No other global menu or footer link grid. The footer is one line: © · Place details from Google · Privacy · Terms.

### 3.2 Routes (26)

| Route | Render | Auth | Design screen |
| --- | --- | --- | --- |
| `/` | SSR | – | Explore (city from cookie, then IP, then default) |
| `/city/[slug]` | SSR | – | Explore for that city |
| `/cities` | SSR | – | Choose a city |
| `/search` | SSR + client | – | Search |
| `/map` | Client | – | Map |
| `/place/[id]` | SSR | – | Place |
| `/place/[id]/check` | Client | ✓ | Check a place |
| `/add` | Client | search: –, submit: ✓ | Add a place (search, confirm, done) |
| `/add/video` | Client | ✓ | Save from a video |
| `/login` | Client | – | Sign in (email, code) |
| `/welcome` | Client | ✓ | First sign-in, 3 steps |
| `/saved` | Client | ✓ | Saved (Places / Lists) |
| `/list/[id]` | SSR | visibility | A list or guide |
| `/friends` | Client | ✓ | Friends feed |
| `/visit/[id]` | SSR | visibility | A friend's visit |
| `/inbox` | Client | ✓ | Inbox (Activity / Recs) |
| `/u/[handle]` | SSR | visibility | Someone's profile |
| `/community` | SSR | – | Community leaderboard |
| `/events` | SSR | – | Events |
| `/event/[id]` | SSR | – | An event |
| `/creator/[platform]/[handle]` | SSR | – | Creator page |
| `/invite/[handle]` | SSR | – | Invite landing |
| `/me` | Client | ✓ | You (Passport / Checks / Lists) |
| `/me/settings` | Client | ✓ | Settings |
| `/me/privacy` | Client | ✓ | Privacy & people |
| `/admin` | Client | moderator | Moderation (Reports / Events) |

Sheets (How verification works, Report, Send, New list) are client overlays on their parent route, not routes. Each one sets a `?sheet=` query parameter so the back button closes it.

---

## 4. Data model

### 4.1 Approach

- Delete `apps/web/migrations/*` and write a single `0001_baseline.sql` that matches `src/db/schema.ts`. Future changes add `0002_…` and so on as normal.
- Rewrite `src/db/schema.ts` to hold only the tables below.
- IDs are text (`crypto.randomUUID()`), except `places.id` keeps its current format. Timestamps are `integer` ms.
- Every user-facing FK to `user.id` is `ON DELETE CASCADE`, except where noted.

### 4.2 Tables

**Auth (keep as-is, Better Auth):** `user`, `session`, `account`, `verification`, `rate_limit`, `auth_otp_rate_limit`.

**Ops (keep):** `google_search_daily`, `moderators`, `audit_log`.

**Places**

| Table | Columns | Notes |
| --- | --- | --- |
| `places` | `id` PK, `name`, `city_slug`, `street_address`, `locality`, `region`, `postal_code`, `country`, `telephone`, `website`, `maps_url`, `google_place_id` UNIQUE, `cuisines` JSON, `lat`, `lng`, `added_by_user_id` FK SET NULL, `listing_status` (`listed` \| `hidden` \| `closed`), `google_details_snapshot`, `google_details_cached_at`, `created_at`, `updated_at` | Dropped: `city_url`, `list_position`, `rating_value`, `review_count`, `source`, `source_url`, `scraped_at`, `halal_confirmed`, `google_place_payload`, `google_place_fetched_at`. Index `(city_slug, listing_status)` and `(lat, lng)`. |
| `place_status` | `place_id` PK FK, `status` (`verified` \| `checking` \| `unchecked`), `progress` 0–3, `owned_value`, `owned_streak`, `certified_value`, `certified_streak`, `pork_value`, `pork_streak`, `alcohol_value`, `alcohol_streak`, `eligible_checks`, `last_checked_at`, `updated_at` | Projection from [§2.5](#25-projection). One row per place, created with the place. Index `(status)`, `(owned_value)`, `(certified_value)`, `(pork_value)`, `(alcohol_value)`. |
| `place_status_changes` | `id`, `place_id`, `from_status`, `to_status`, `fact` NULL, `from_value`, `to_value`, `created_at` | Feeds `status-changed` notifications and the change line on the place page. |
| `saved_places` | `user_id`, `place_id`, `created_at`; PK `(user_id, place_id)` | Unchanged. "Want to try" writes here. |
| `place_photos` | `id`, `place_id`, `user_id`, `check_id` NULL FK SET NULL, `r2_key` UNIQUE, `content_type`, `byte_size`, `created_at` | Photos added from a check carry `check_id`. |
| `place_media_links` | as today | Videos. Creator page groups by `(platform, author_handle)`. |

**Checks (replaces verifications, check-ins, visits, ratings, reviews, dishes)**

| Table | Columns | Notes |
| --- | --- | --- |
| `checks` | `id`, `user_id`, `place_id`, `owned`, `certified`, `pork`, `alcohol` (each `yes`\|`no`\|`unsure`\|NULL), `verdict` (`no`\|`okay`\|`liked`\|`loved`\|NULL), `note` ≤ 500, `shared` bool, `excluded` bool default 0, `idempotency_key` UNIQUE per user, `created_at` | One row per visit. The latest row per `(user_id, place_id)` is the one that counts. Index `(place_id, created_at DESC)`, `(user_id, created_at DESC)`, `(user_id, place_id, created_at DESC)`. CHECK: at least one of the four facts is `yes`/`no`. |
| `check_dishes` | `check_id`, `position`, `name` ≤ 60; PK `(check_id, position)` | At most 5 per check. "What people order" groups by `lower(trim(name))` over non-excluded checks from the last 365 days, top 3. |

**People**

| Table | Columns | Notes |
| --- | --- | --- |
| `profiles` | `user_id` PK, `handle` UNIQUE (3–30 chars, `[a-z0-9_.]`), `display_name`, `bio` ≤ 160, `avatar_key`, `home_city_slug`, `is_private`, `lists_private_default`, `show_on_leaderboards`, `default_filters` JSON, `onboarded_at`, `invited_by_user_id` SET NULL, `suspended_at`, `created_at`, `updated_at` | Merges `user_profiles` and the parts of `user_preferences` we keep. `default_filters` = `{verified, owned, certified, noPork, noAlcohol}`. |
| `follows` | as today | `pending` / `accepted`. |
| `blocks` | as `user_blocks` | Renamed. |

**Social**

| Table | Columns | Notes |
| --- | --- | --- |
| `likes` | `check_id`, `user_id`, `created_at`; PK both | Replaces `reactions`. |
| `comments` | `id`, `check_id`, `user_id`, `body` ≤ 500, `status` (`visible`\|`hidden`), `created_at` | `visit_id` → `check_id`. |
| `recs` | `id`, `sender_id`, `recipient_id`, `place_id` NULL, `list_id` NULL, `event_id` NULL, `note` ≤ 140, `reply` (`in`\|`want-to-try`) NULL, `replied_at`, `read_at`, `created_at` | CHECK: exactly one of place/list/event. Adds `event_id` because the design lets you send an event. |
| `notifications` | as today, with `check_id` instead of `visit_id`, `status_change_id` → `place_status_changes`, no `verification_id` | Kinds in [§8](#8-notifications). |

**Lists**

| Table | Columns | Notes |
| --- | --- | --- |
| `lists` | `id`, `owner_id`, `kind` (`ranked`\|`plan`\|`guide`), `title` ≤ 80, `caption` ≤ 200, `visibility` (`public`\|`followers`\|`private`), `city_slug` NULL, `created_at`, `updated_at` | Dropped: `slug`, `description`, `cover_place_id` (the cover is the first item's photo), `edit_token`. `guide` lists can only be created by moderators. |
| `list_items` | `list_id`, `place_id`, `position`, `note` ≤ 140, `added_by_user_id`, `created_at`; PK `(list_id, place_id)` | |
| `list_members` | `list_id`, `user_id`, `status` (`invited`\|`accepted`), `invited_by`, `created_at` | `plan` lists only. |
| `list_saves` | as today | |

**Community**

| Table | Columns | Notes |
| --- | --- | --- |
| `points` | `id`, `user_id`, `kind` (`check`\|`place-added`\|`helped-verify`), `place_id`, `check_id` NULL, `city_slug`, `points`, `created_at` | Append-only ledger ([§10](#10-points-and-leaderboard)). Index `(city_slug, created_at)`, `(user_id)`. UNIQUE `(user_id, kind, place_id, date(created_at))`, so one award per kind per place per day. |
| `events` | as today, `status` adds `draft` | |
| `event_vendors` | as today | The status shown is the linked place's `place_status`, or "Not checked yet" when there's no linked place. |
| `event_rsvps` | as today | |

**Moderation**

| Table | Columns | Notes |
| --- | --- | --- |
| `reports` | `id`, `target_type` (`place`\|`check`\|`comment`\|`user`\|`list`), `target_id`, `reporter_id` SET NULL, `reason`, `detail` ≤ 500, `status` (`open`\|`actioned`\|`dismissed`), `action` NULL, `reviewed_by`, `created_at`, `updated_at` | Place reasons: `closed`, `wrong-answers`, `wrong-details`, `duplicate`, `other`. Content reasons: `harassment`, `spam`, `other`. |

**Dropped entirely:** `place_halal_verifications`, `place_halal_verification_evidence`, `place_halal_check_answers`, `place_ratings`, `place_reviews`, `user_preferences`, `place_facts`, `place_halal_status_history`, `place_dishes`, `place_visits`, `place_check_ins`, `place_check_in_dishes`, `place_edit_suggestions`, `place_duplicate_reports`, `community_confirmations`, `report_appeals`, `place_source_records`, `place_observations`, `place_inspections`, `city_coverage_requests`, `contributor_standing`, `sponsored_placements`, `transaction_handoffs`, `feed_events` (the feed reads `checks` directly), `reactions`, `place_link_submissions`.

### 4.3 R2

One bucket (`HALAL_EVIDENCE_R2`, rename it `HALALFOOD_R2`). Use the prefixes `photos/`, `avatars/` and `check-photos/`. Evidence-document uploads go away.

### 4.4 Reset and seed

1. `scripts/export-places.ts`: read `places` from the current remote D1 (with `d1-rest-client.ts`) and write `seed/places.jsonl` holding only the kept columns, for `listing_status = 'listed'` rows.
2. Drop and recreate the remote D1 database (and each preview database), then apply `0001_baseline.sql`.
3. `scripts/seed-places.ts`: insert `seed/places.jsonl` and a `place_status` row (`unchecked`) for each place.
4. Keep `apply-d1-migrations.ts` and the migration gate unchanged.

Keep the `listing-visibility.ts` rule that hides alcohol-led venues (bars). It runs at seed time and on add.

---

## 5. API

All routes are under `app/api`. Conventions stay as they are today: JSON, `no-store` for authenticated responses, a short public cache otherwise, 401 / 403 / 429 / 503 shapes from `src/lib/api.ts`, and Turnstile on sign-in. Rate limits are per user unless noted.

### 5.1 Places and checks

| Method & path | Purpose |
| --- | --- |
| `GET /api/places?bbox=&city=&filters=&friends=1&cursor=` | Explore list and map. `filters` = comma list of `verified,owned,certified,no-pork,no-alcohol`. `friends=1` limits results to places that people you follow have shared checks at, or saved. Response items: `{id, name, cuisine, area, distanceKm, lat, lng, status, facts, friend?: {handle, initials, line}, saved}`. Nearest first, up to 200 on the map and 30 per page in the list. |
| `GET /api/places/[id]` | Place payload for client refreshes (the page itself is SSR). |
| `GET /api/search?q=` | `{places, people, lists, cities}`, 5 each. `q` is capped at 64 characters and matched with `instr()` as today. |
| `GET /api/places/google-search?q=` | Unchanged (Add search). Each result is marked `alreadyListedId` if its `google_place_id` exists. |
| `POST /api/places` | Body `{googlePlaceId, answers?}`. Creates a `listed` place, `place_status`, an optional first check, and `place-added` points. 409 with `{id}` if it already exists. 10 per day. |
| `POST /api/places/[id]/checks` | Body `{owned, certified, pork, alcohol, verdict?, dishes?[], note?, shared, photoKeys?[], idempotencyKey}`. 422 if no definite answer. Writes the check and dishes, recomputes status, awards points, and fans out notifications. Returns `{check, status}`. 20 per day. |
| `GET /api/places/[id]/notes?cursor=` | "What people said": non-excluded checks with a note, newest first, respecting privacy and blocks. |
| `POST /api/places/[id]/photos` · `DELETE /api/photos/[id]` | Same as today, plus an optional `checkId`. |
| `POST /api/places/[id]/saved` · `DELETE …` | Same as today. |
| `GET /api/saved` | The user's saved places. |
| `POST /api/media/match` | Body `{url}` → oEmbed lookup, then a place match: `{media, candidates[]}`. |
| `POST /api/places/[id]/media` | Link a video to a place (from Save from a video, which also saves the place). |

### 5.2 People and social

| Method & path | Purpose |
| --- | --- |
| `GET/PUT /api/me` | Profile and settings (`display_name`, `handle`, `bio`, `avatar`, `default_filters`, `is_private`, `lists_private_default`, `show_on_leaderboards`). |
| `POST /api/me/avatar` | Upload an avatar. |
| `GET /api/handles/check?h=` | Same as today. |
| `POST /api/me/onboarding` | Body `{step: "profile" \| "filters" \| "done"}` → sets `onboarded_at` on `done`. |
| `GET /api/people/suggested?city=` | Onboarding "Popular in {city}": the top 10 by followers plus points over 30 days, excluding private accounts and people already followed. |
| `GET /api/u/[handle]` | Public profile with counts, gated by privacy and blocks. |
| `PUT/DELETE /api/follows/[handle]` | Follow (`pending` for private accounts) or unfollow. |
| `POST/DELETE /api/follow-requests/[handle]` | Accept or decline. |
| `PUT/DELETE /api/blocks/[handle]` | Block or unblock. A block removes follows both ways. |
| `GET /api/feed?cursor=` | Shared checks from accepted followees, minus blocks, newest first, 20 per page. Items carry like and comment counts, `likedByMe`, and `savedByMe`. |
| `GET /api/checks/[id]` | Visit page payload. |
| `PUT/DELETE /api/checks/[id]/like` | Like or unlike. |
| `GET/POST /api/checks/[id]/comments` · `DELETE /api/comments/[id]` | Comments, 500 characters max. Delete: your own comment, or anything as a moderator. |
| `GET /api/inbox?tab=activity\|recs&cursor=` · `POST /api/inbox/read` | Notifications and recs. `read` takes `{ids?}` or marks everything read. |
| `GET /api/inbox/summary` | `{unread}` for the bell and tab dot. |
| `GET /api/recs/recipients` | People you follow or who follow you, most recently interacted first. |
| `POST /api/recs` | Body `{to: handle[] (max 10), placeId \| listId \| eventId, note?}`. 30 per day. |
| `POST /api/recs/[id]/reply` | Body `{reply: "in" \| "want-to-try"}`. `want-to-try` on a place also saves it. |

### 5.3 Lists

| Method & path | Purpose |
| --- | --- |
| `GET/POST /api/lists` | Mine, grouped `{own, planning, saved}`; create with `{title, kind, visibility}`. |
| `GET/PUT/DELETE /api/lists/[id]` | Read (with visibility checks), edit, delete (owner only). |
| `PUT /api/lists/[id]/items` | Replace the order. `ranked`: every place must have a check by the owner (422 otherwise). |
| `POST/DELETE /api/lists/[id]/items/[placeId]` | Add or remove with an optional `note`. On `plan` lists, accepted members can add; removing is the owner's or the adder's job. |
| `POST /api/lists/[id]/members` · `POST …/members/accept` · `DELETE …/members/[handle]` | Invite, accept, or leave/remove. |
| `PUT/DELETE /api/lists/[id]/save` | Save or unsave someone else's list. |

"You've been to *x* of *y*" is computed server-side: items where the viewer has any check at that place.

### 5.4 Community and events

| Method & path | Purpose |
| --- | --- |
| `GET /api/community?city=&period=week\|all` | Top 50 plus the viewer's own row ([§10](#10-points-and-leaderboard)). |
| `GET /api/events?city=` · `GET /api/events/[id]` | Published events; vendors with place status; friends going. |
| `PUT/DELETE /api/events/[id]/going` | RSVP. |
| `GET /api/creators/[platform]/[handle]` | Linked videos with place status. |

### 5.5 Moderation

| Method & path | Purpose |
| --- | --- |
| `POST /api/reports` | Body `{targetType, targetId, reason, detail?}`. 10 per day. |
| `GET /api/admin/reports?status=open` | Queue, oldest first. |
| `POST /api/admin/reports/[id]` | Body `{action}`. One of: `reset-checks` (set `excluded = 1` on all checks at the place created before now, then recompute), `mark-closed` (`listing_status = closed`), `merge` (`{intoPlaceId}`: move checks, photos, saves, list items, media, vendors and points, then delete the source place and recompute both), `fix-details` (`{name?, telephone?, website?, address?}`), `hide-comment`, `exclude-check`, `suspend-user`, `dismiss`. Every action writes `audit_log`. |
| `GET/POST /api/admin/events` · `PUT/DELETE /api/admin/events/[id]` | Create or edit events and vendors; publish or draft. |

### 5.6 Deleted endpoints

Delete every route under `app/api` that is not listed above. That includes `verifications`, `rating`, `reviews`, `decision`, `check-ins`, `dishes`, `duplicates`, `edits`, `discover`, `confirmations`, `contributions`, `passport`, `preferences`, `profile`, `onboarding/picks`, `people/search`, `leaderboard/*`, `lists/search`, `lists/*/edit-link`, `lists/*/join`, `notifications/*`, `recs/read`, `reports/*/appeal`, `admin/queue`, `admin/review/*`, `admin/places/*`, `admin/audit`, `cities/*/coverage`, `uploads/r2` (photos are served from `GET /api/photos/[key]`), and `visits/*`.

---

## 6. Screens

The design canvas is the reference for each screen. This section adds the data source, states and rules a builder needs. "Empty", "Loading" and "Error" follow [§7.4](#74-states).

### 6.1 Explore (`/`, `/city/[slug]`)

- Header: city switcher → `/cities`; signed in: Inbox bell with an unread count, plus an avatar → `/me`; signed out: Sign in.
- Search field → `/search`.
- "This week in {city}": events in the next 7 days, up to 5, horizontal. Hidden when there are none.
- "Guides & lists": `guide` lists for the city first, then the most-saved public lists with city items, up to 6. Hidden when there are none.
- "Places near you": filter chips `Friends' picks` (signed in only), `Verified`, `Muslim-owned`, `Halal certified`, `No pork`, `No alcohol`. Initial state = `profiles.default_filters`, or `localStorage` when signed out. Each change persists back to the same place.
- Place row: photo or initials art, name, `cuisine · area · distance`, status pill, fact tags (favourable ones in green, `Serves pork/alcohol` in red, `Not Muslim-owned` in grey), and an optional friend line ("Zaid and 2 friends loved this" when a followee's latest shared check has verdict `loved`/`liked`; "Farah wants to try this" when only a save exists). A heart toggles save. Signed out, the heart goes to `/login?returnTo=`.
- Floating Map button → `/map` with the same filters.
- Empty filter result: "No places match all of these" plus Clear filters.

### 6.2 Search (`/search`)

A live query, debounced 200 ms. Blank shows the suggestions `biryani`, `shawarma`, `@{a followee}`, `{a city}`. Sections in order: Places, People, Lists & guides, Cities, each shown only if non-empty. With no results: "Nothing listed yet" plus Add a place.

### 6.3 Choose a city (`/cities`)

Use my location (browser geolocation, then the nearest city). A filterable list of cities with place counts; the current city is ticked. Picking one sets the `city` cookie and goes to `/city/[slug]`.

### 6.4 Map (`/map`)

Keep MapLibre and CARTO Positron. Pins are coloured by status: verified (filled green with a check), checking (white with an amber ring), unchecked (grey). A followee's initials badge sits on a pin when the friend line applies. Same chips as Explore. A 3-item legend. Tapping a pin opens a single place card (art, name, meta, status, friend line) → `/place/[id]`. Search this area appears after a pan, as today. List button → `/`.

### 6.5 Place (`/place/[id]`)

Top to bottom:

1. Hero photo (latest place photo, else initials art), with Back, Send (→ Send sheet), Share (Web Share API, else copy link) and Save. "1 / n photos" opens the gallery.
2. Name, then `cuisine · street address, city`.
3. **Status card**: tone by status, title, subline (`verified`: "3 people checked separately and agree · latest {date}"; `checking`: "One more matching check makes this Community verified" when progress is 2, otherwise "{3−progress} more matching checks to verify"; `unchecked`: "Nobody has checked this place. That doesn't mean it isn't halal."), a 3-segment meter, and "How verification works" → sheet.
4. **Halal facts**: 4 tiles. Each shows the question, the answer (`Yes`/`No`; `Served`/`Not served` for pork and alcohol; `Not known yet` when `value` is null) and an icon tone from [§2.4](#24-favourable-values).
5. Actions: Directions (`maps_url`), Call (when there's a telephone), Website (when there's a website).
6. **Friends who've been** (signed in, at least one followee with a shared check): an avatar stack, one line, and the newest note → that check's visit page.
7. **Eaten here?** card → `/place/[id]/check`. The copy varies by status, as in the design.
8. **What people order**: the top 3 dishes with counts ([§4.2](#42-tables)). Hidden when there are none.
9. **Photos**: 3 thumbnails, "+n", and an Add button (camera or file input, 8 MB, JPEG/PNG/WebP).
10. **Videos**: linked media → creator page. Hidden when there are none.
11. **What people said**: the 2 newest notes; "See all" loads more.
12. **Nearby**: 2 places within 10 km.
13. Add to a list (→ New list sheet with an "Add to existing" list picker on top), and Report a problem (→ Report sheet).

On ≥ 1024 px, use two columns: items 1–5 on the left and 6–13 on the right.

### 6.6 How verification works (sheet)

Static copy from the design. Got it closes the sheet.

### 6.7 Report a problem (sheet)

Five radio reasons, an optional detail field, and Send report → `POST /api/reports` → a "Thanks, a moderator will look" toast, then close. Requires sign-in.

### 6.8 Check a place (`/place/[id]/check`)

- Four questions, each with Yes / No / Not sure buttons; tapping the selected one again clears it.
- "How was it?" (optional): Not for me / Okay / Liked / Loved.
- "What did you order?": chips; Enter or comma adds one; up to 5.
- Photo and Note (500 characters).
- "Share with followers" switch, on by default. For a private account, shared means accepted followers only.
- Send check is disabled until at least one question has Yes or No.
- The draft is kept in `sessionStorage` (as `check-in-draft.ts` does today) so a sign-in round-trip doesn't lose it.
- Submit → `POST /api/places/[id]/checks` → **Check sent** screen: before/after meter, outcome copy ("Your answers match the last two checks. {Place} is now Community verified.", "…stays Community verified.", "That's 2 of 3. One more to verify.", or "Your answers differ from recent checks. The place waits for 3 that match."), then Back to the place and Find more places.

### 6.9 Add a place (`/add`)

1. **Search**: Google results. "Already listed" results link to the place. A card links to "Saw it in a video?" (`/add/video`). Footer note.
2. **Confirm**: mini map with a pin, name and address, the 4 compact questions (`Yes` / `No` / `?`), and Add place. The hint "It goes live straight away as '1 of 3 checks' / 'Not checked yet'" updates live.
3. **Done**: success copy, a meter at 1 of 3 (or none), Share the place, See the place.

Signed out: search works; Add place goes to `/login?returnTo=/add?g={googlePlaceId}`, which then resumes at Confirm.

### 6.10 Save from a video (`/add/video`)

Paste a URL → Find → shows the media card (oEmbed author and title) and the top candidate ("We think it's …") with status → Save to Want to try (saves the place and links the media). "Not this place? Search" → `/search`. No candidate: "Couldn't match this video", Search, and Add it from Google Maps. Instagram links have no caption, so they skip straight to the search state.

### 6.11 Sign in (`/login`)

Email → Send code → 6-digit code → Continue. Turnstile stays (invisible). Resend after 30 s; "Use a different email". A new account goes to `/welcome`; otherwise to `returnTo`, or `/`.

### 6.12 First sign-in (`/welcome`)

A 3-segment progress bar.

1. **Profile**: optional photo, name (required), handle (required, live availability check, prefilled from the email's local part).
2. **What matters**: 5 checkboxes saved to `default_filters`. Skip is allowed.
3. **Follow a few people**: search, "Popular in {home city}" suggestions with Follow buttons, Copy your invite link (`/invite/{handle}`). The final button reads "Done · following n", or "Skip for now".

Completing step 3 sets `onboarded_at`. Leaving early lands on `/` with onboarding resumable from `/me`.

### 6.13 Saved (`/saved`)

A Places / Lists segmented control, remembered in `localStorage`.

- **Places**: saved places, newest first; the heart unsaves with an undo toast. Ends with a "Save a place from a video" card.
- **Lists**: groups *Your lists*, *Planning with friends* and *Lists you saved*, each row with a badge (Ranked, Private, "n people", Guide). New list → sheet.

Signed out: the design's empty state with Sign in.

### 6.14 A list (`/list/[id]`)

Cover (the first item's photo), kind badge, Back, Send. Title, caption, people (owner, or accepted members for `plan` lists) and a byline (`guide`: "Guide by halalfood.world · updated {month}"). A "You've been to x of y" bar, plus Save list for lists that aren't yours. Owner or member actions: Edit (sheet: title, caption, visibility; Delete for the owner), Add place (→ search in picker mode), Invite (`plan` only → Send sheet in "invite to list" mode). Items are numbered for `ranked`, bulleted otherwise; each shows status, an optional note, and a been tick. The tick is derived; tapping an unticked one → `/place/[id]/check`. Owners reorder `ranked` lists with drag handles (on ≥ 768 px) or Move up/down buttons (on mobile).

### 6.15 New list (sheet)

Name, type (Plan with friends / My ranking; moderators also see Guide), and who can see it (Everyone / Followers / Only me; the default comes from `lists_private_default`). Create → the new list. When opened from a place, that place is added as the first item.

### 6.16 Friends (`/friends`)

Header with Community (trophy), Inbox (bell with count) and Find people (→ `/search`, focused on people). Feed cards: avatar, "**Name** {loved|liked|checked|tried} **Place**", time and area, optional photo, note, status pill, dish chips, Like (count), Comment (count) and Want to try. The verb comes from the verdict (`loved`, `liked`); with no verdict or `okay`/`no`, use "checked".

Empty (follows nobody): "Follow people to see where they eat" plus suggestions from [§6.12](#612-first-sign-in-welcome) step 3. Signed out: a sign-in prompt.

### 6.17 A friend's visit (`/visit/[id]`)

Author header with Report (flag). Photo, a place card with status and verdict badge, the note, dishes, Like with "{names} and n others", Comments (oldest first) and a sticky composer. Visible only under the check's privacy ([§9](#9-privacy-safety-and-abuse)); otherwise "This visit isn't available".

### 6.18 Inbox (`/inbox`)

An Activity / Recs segmented control (a `?tab=` query parameter) and Mark all read.

- **Activity**: rows with an unread dot, avatar or status icon, text, time; follow requests have inline Accept and Decline. Each row deep-links.
- **Recs**: cards with sender, note, target (place, list or event) and status, plus I'm in and Want to try (save or unsave). Ends with a "Send a place to a friend" card.

### 6.19 Send to friends (sheet)

Title "Send {target}". A friend grid (recipients API) with multi-select, up to 10. A note with a 140-character counter. Copy link and Send to n. Success toast. In "invite to list" mode the button reads "Invite n" and calls the members API instead.

### 6.20 Someone's profile (`/u/[handle]`)

Avatar, name, handle and city, bio, followers, following, rank in their city. Follow / Following / Requested, plus Send a rec. An overflow menu with Share profile, Report and Block (with a confirm). Stats: places, checks, cities, cuisines. Lists (public, or followers-only when the viewer follows). Recent visits (shared checks under the privacy rules). A private account that the viewer doesn't follow shows only the header and "This account is private".

### 6.21 Moderation (`/admin`)

Moderators only (403 page otherwise). Reachable from You.

- **Reports**: open reports, oldest first. Each card has the target link, reason pill, detail, reporter and date, a primary action that depends on the reason (`wrong-answers` → Reset checks; `closed` → Mark closed; `duplicate` → Merge, with a place picker; `wrong-details` → Fix details, with an inline form; comment `harassment`/`spam` → Remove comment; check → Exclude check; user → Suspend), and Dismiss.
- **Events**: a list with Live/Draft pills, and New event / edit (title, city, venue, address, start, end, description, vendors: search a place or type a name, reorder; Save draft or Publish).

### 6.22 Community (`/community`)

A city switcher, This week / All time, a one-line rules note, a top-3 podium, ranks 4–50, and the viewer's row pinned and highlighted. Private accounts and people with `show_on_leaderboards = 0` are never listed. If that applies to the viewer, their own row reads "You're hidden from leaderboards" with a link to Privacy.

### 6.23 Events (`/events`) and an event (`/event/[id]`)

- **List**: upcoming published events for the city, each with a date block, title, time and venue, "x of y stalls verified" (or "Stalls coming soon") and a friends-going line.
- **Detail**: hero, title, when and where, I'm going (toggle) and Send, friends going (followees with an RSVP, viewer included), and Stalls (name, what they sell, status pill). Each stall links to its place, or to `/add` when unlinked. One line of copy plus Check a stall.

### 6.24 Creator page (`/creator/[platform]/[handle]`)

Avatar, `@handle`, platform and the count of places linked. A note that a video is taste, not a halal check. A 2-column grid of video thumbnails, each with place name and status → place.

### 6.25 Invite landing (`/invite/[handle]`)

The inviter's avatar, "{Name} invited you to halalfood.world", one line, and their top 2 places (most recent `loved` checks). Join and follow {Name} → `/login?invite={handle}`; on account creation, follow the inviter (auto-accepted even if private, since the inviter shared the link), set `invited_by_user_id`, and notify the inviter. Just look around → `/`. An unknown handle → 404.

### 6.26 You (`/me`)

Header with Invite friends (→ copies the invite link) and Settings. Avatar, name, handle and city, followers, following and rank (→ `/community`). Stats: checks, places added, helped verify. A Moderation row with an open-report count (moderators only). Passport / Checks / Lists tabs:

- **Passport**: a mini map of every place you've checked, counts for cities, cuisines, countries and went-back (places with ≥ 2 checks), and milestones (reuse `food-passport.ts`; the milestone set is `first-check`, `first-verify`, `10-cuisines`, `regular` (3 places revisited) and `5-cities`). Locked milestones show progress ("4/5").
- **Checks**: your checks, newest first, each with date, verdict and a pill (`✓ Verified` when the place is verified; otherwise "Needs n more").
- **Lists**: your lists.

### 6.27 Settings (`/me/settings`) and Privacy & people (`/me/privacy`)

- **Settings**: photo, name, handle (editable, with an availability check), bio, Save profile; rows for Privacy & people (with the pending request count), Default filters (→ the same 5 checkboxes in a sheet), Email (read-only), Sign out, Delete account (confirm, then delete the user; checks stay but become anonymous: set `checks.user_id` to the system user `deleted`, keep the answers so statuses hold, and cascade-delete everything else).
- **Privacy & people**: switches for Private account, Lists private by default and Show me on leaderboards; Follow requests (Accept / Decline); Blocked (Unblock).

---

## 7. Design system

### 7.1 Tokens

Replace the `:root` values in `packages/ui/src/styles/globals.css`. Keep the Tailwind token names so existing shadcn components inherit them.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--foreground` | `#1F1A17` | `#F6F1EC` | Text, primary dark buttons, selected chips |
| `--muted-foreground` | `#6F6760` | `#B7ADA5` | Secondary text (4.6:1 on white) |
| `--subtle-foreground` | `#5F5852` | `#C9BFB7` | Hints, captions |
| `--background` | `#FFFFFF` | `#171413` | Page |
| `--muted` | `#FBF7F2` | `#211D1B` | Cream cards (Eaten here?, passport tiles) |
| `--secondary` | `#F5F1EC` | `#2A2522` | Search fields, segmented track, dish chips |
| `--border` | `#EAE4DD` | `#3A3431` | Card borders, dividers |
| `--input` | `#DCD4CB` | `#4A423E` | Unselected chip and button borders |
| `--primary` | `#C9461D` | `#F0703F` | One primary CTA per screen, active tab, badges |
| `--brand` | `#E4572E` | `#F0703F` | Logo mark only |
| `--success` / `--success-muted` | `#1F6B45` / `#E3F2E9` | `#5CC48D` / `#15301F` | Verified |
| `--warning-strong` / `--warning-muted` | `#74500C` / `#FFF1D6` | `#F2B33D` / `#3A2C0F` | n of 3 checks |
| `--neutral-pill` / `--neutral-pill-fg` | `#F1EEEA` / `#5F5852` | `#2A2522` / `#C9BFB7` | Not checked yet |
| `--destructive` / `--destructive-muted` | `#B3261E` / `#FBE5E3` | `#EF6B61` / `#3A1A17` | Serves pork/alcohol, Delete, Block |

- Font: Nunito Sans. Weights: 600 body, 700 meta, 800 labels and buttons, 900 headings.
- Type scale (px): 12 pill, 13 meta, 14 secondary, 15 body, 16 row title, 17 question, 19 section, 20 top-bar title, 24 sheet title, 26–30 page title.
- Radii: 999 pills, chips and avatars; 12 small buttons; 14 buttons and inputs; 16 tiles; 20 cards; 28 sheet top.
- Spacing: 20 px page gutter on mobile (24 on form screens), 22–26 px between sections.
- Every touch target is at least 44 × 44.

### 7.2 Components

Build these in `packages/ui/src/components` (or `apps/web/src/components` where they need app data). Every screen is composed only from them.

| Component | Notes |
| --- | --- |
| `TabBar` | 5 tabs, an active state, and the Friends dot. Becomes the top nav at md. |
| `TopBar` | Back/close, title, up to 3 icon actions. |
| `StatusPill` | `verified`, `checking(n)`, `unchecked`; `size: sm \| md`; short form ("✓ Verified", "2 of 3"). |
| `StatusCard` | Tone, title, subline, `Meter`, link. |
| `Meter` | 3 segments, tone. |
| `FactTile` / `FactTags` | From `FactState`. |
| `AnswerGroup` | Yes / No / Not sure, or `compact` (Yes / No / ?). Uses `aria-pressed`. |
| `VerdictGroup` | 4 options. |
| `FilterChips` | Scrollable row with `aria-pressed`. |
| `Segmented` | 2–3 tabs with `role="tablist"`. |
| `PlaceRow`, `PlaceCardMini`, `PlaceMapCard` | |
| `ListRow`, `ListCard`, `EventCard`, `EventRow`, `VideoThumb` | |
| `Avatar`, `AvatarStack`, `PersonRow` | Initials art on deterministic colour pairs from the design palette (`#D3E0E6`/`#2F4A5E`, `#DCE8D5`/`#2E5A36`, `#E8DDF0`/`#5A3A6B`, `#F6E2B3`/`#6B4A0E`, `#F1D3B6`/`#7A3E14`). |
| `FeedCard`, `CommentList`, `Composer` | |
| `Sheet` | Bottom sheet on mobile, centred dialog at md. Focus trap, Esc, and `?sheet=` back handling. |
| `Switch`, `Checkbox`, `RadioCard`, `TextField`, `TextArea` with counter | |
| `Button` | `primary` (orange), `dark`, `outline`, `ghost`, `danger`, `success-state` (✓ done). |
| `EmptyState`, `Toast`, `Skeleton` | |

Icons: keep `@hugeicons/react` and map each design icon to the nearest Hugeicon, stroke 2. No emoji.

### 7.3 Copy rules

- One primary CTA per screen.
- No disclaimers beyond the few in the design. Never say "certified" about our own status. "Halal certified" only ever means the restaurant's own certificate.
- Status strings exactly: "Community verified", "{n} of 3 checks", "Not checked yet".

### 7.4 States

- **Loading**: skeletons in the shape of the content, no spinners on full screens.
- **Errors**: an inline line with Try again; keep the failure copy from `failure-copy.ts`.
- **Empty**: every list has the empty state shown in the design or listed in [§6](#6-screens).
- **Optimistic UI** for likes, saves, follows, RSVPs and rec replies, rolled back with a toast on failure.

---

## 8. Notifications

Written at event time, once per `dedupe_key`, never across a block, and never to the actor.

| Kind | Recipient | Trigger | Text |
| --- | --- | --- | --- |
| `status-changed` | Users who saved the place | `place_status_changes` row | "{Place} is now Community verified. You saved it." / "{Place} changed: it now {serves alcohol}, from 3 recent checks." |
| `follow` | Followee | Follow of a public account | "{Name} followed you" |
| `follow-request` | Followee | Follow of a private account | "{Name} wants to follow you" (inline Accept/Decline) |
| `follow-accepted` | Follower | Accept | "{Name} accepted your request" |
| `like` | Check author | Like | "{Name} liked your visit to {Place}" (collapsed per check per day) |
| `comment` | Check author, plus earlier commenters | Comment | "{Name} commented on {Place}" |
| `friend-visit` | Followers who saved that place | Shared check | "{Name} went to {Place}, on your want-to-try list" |
| `list-invite` | Invitee | Members invite | "{Name} invited you to plan '{List}'" |
| `rec` | Recipient | Rec | In the Recs tab, not Activity |
| `rec-reply` | Sender | Reply | "{Name} is in for {Place}" / "…saved {Place}" |
| `invite-joined` | Inviter | Invite sign-up | "{Name} joined from your invite" |

Unread count = unread notifications + unread recs.

---

## 9. Privacy, safety and abuse

**Visibility of a check** (feed, visit page, profile, place notes, friend lines):

- Author blocked by the viewer, or the viewer blocked by the author: hidden.
- `shared = 0`: only the author sees it. The halal answers still count toward status anonymously; "What people said" never shows it.
- `shared = 1`, public account: everyone.
- `shared = 1`, private account: accepted followers and the author.

**Lists**: `public` is visible to everyone, `followers` to accepted followers, members and the owner, `private` to the owner and members.

**Profiles**: a private account shows only its header to non-followers.

**Abuse controls:**

- 24-hour account age before a check counts toward status.
- One counted check per person per place (only the latest).
- Turnstile on sign-in.
- Per-user daily limits: checks 20, places 10, recs 30, reports 10, comments 100. Per-IP limits on auth stay as today.
- A merge or reset recomputes status.
- Suspended accounts' checks stop counting and their content is hidden.

---

## 10. Points and leaderboard

- `check`: **3** points, when a check is created. At most once per place per day.
- `place-added`: **5** points, when a place is created through Add.
- `helped-verify`: **10** points, awarded to each author of the 3 checks that formed the final streak when a place first becomes `verified`. Not re-awarded if the place drops out of verified and later returns.
- Excluded checks lose their `check` points: on exclude, delete the ledger rows for that `check_id`.
- Leaderboard: `SUM(points)` grouped by user for `city_slug` and period. Week = Monday 00:00 in the city's timezone, using the city table's tz, or UTC if unknown. Top 50, then the viewer's own rank via a window function. Ties are broken by earliest reaching the total.
- "#12 in Mumbai" on profiles uses the all-time rank in the user's `home_city_slug`.

---

## 11. SEO

- SSR with JSON-LD stays for `/`, `/city/[slug]` (`ItemList`), `/place/[id]` (`Restaurant` plus a community note, no fake `aggregateRating`), `/list/[id]` (public only), `/u/[handle]` (public only), `/events`, `/event/[id]` (`Event`) and `/creator/...`.
- `sitemap.ts` lists cities, listed places, public lists, public profiles with at least one shared check, and upcoming events.
- `robots.ts` disallows `/me`, `/saved`, `/inbox`, `/friends`, `/admin`, `/welcome`, `/add` and `/login`.
- No redirects for removed URLs. They 404.

---

## 12. What to delete

Delete these as part of the phase that replaces them. Run `npm run typecheck` after each deletion to catch stragglers.

**App routes:** `app/feed`, `app/activity`, `app/recs`, `app/send`, `app/lists`, `app/passport`, `app/paste`, `app/guides`, `app/log`, `app/contributions`, `app/preferences`, `app/settings`, `app/leaderboard`, `app/onboarding`, and `app/map-filters.tsx`. In `app/place/[id]/`, delete `place-check-in.tsx`, `place-contribute.tsx`, `place-halal-verification.tsx`, `place-moderation.tsx`, `place-rating.tsx`, `place-reviews.tsx`, `personal-suitability.tsx` and `block-load-error.tsx`. In `app/admin/`, delete `admin-console.tsx`. Rebuild the rest under the new routes.

**Components:** `evidence-panel`, `decision-summary`, `provenance-panels`, `community-chain`, `community-rows`, `city-coverage`, `eating-city-form`, `home-tabs`, `header-actions`, `account-menu`, `section`, `art` (replace with `Avatar`/initials art), `blocks`, `form-fields`, `status-tone`, and `site-chrome` (replaced by `TabBar`/`TopBar`/footer).

**`apps/web/src/lib`:** `city-coverage-read`, `community-confirmations`, `contributions-repository`, `contributor-leaderboard`, `coverage-repository`, `diner-leaderboard` (replaced by `community-repository`), `discover-response`, `dishes-repository`, `eating-city`, `focused-flow`, `guides`, `halal-status`, `halal-verification`, `halal-verifications`, `listing-moderation`, `local-context`, `local-context-repository`, `observations-repository`, `onboarding-picks`, `place-decision`, `place-duplicates`, `place-link-submissions`, `place-ratings`, `place-reviews`, `preferences-repository`, `reputation-repository`, `restaurant-page` (fold into the place loader), `search-copy`, and `visits` (replaced by `checks-repository`). Rewrite `discovery.ts` against `place_status`.

**`packages/core/src`:**

- Delete: `anti-manipulation`, `card-evidence`, `commercial`, `contributions`, `coverage`, `halal-glance-view`, `halal-status-view`, `halal-taxonomy`, `observations`, `place-facts`, `reputation`, `user-preferences`, `visit-verification`.
- Add: `halal.ts` ([§2](#2-halal-status-the-algorithm)) and `points.ts`.
- Rewrite: `check-in.ts` → `check.ts` (validation of the check payload), `discovery-filters.ts` (5 filters plus friends), `moderation.ts` (report reasons and actions), `notifications.ts` (the new kinds).
- Keep, adapting to the new tables: `feed`, `social`, `recs`, `events`, `leaderboard`, `place-lists`, `food-passport`, `map-social`, `media-match`, `public-identity`, `listing-visibility`, `discovery-bbox`, `map-viewport`, `params`, `place-submission`.

**Tests:** delete the tests of deleted modules (in `packages/core/tests` and `apps/web/tests`). Rewrite the launch-gate tests (`launch-blockers`, `launch-gate`, `launch-ready`, `trust-lifecycle`) against the new rules.

**Docs:** replace `docs/product/trust-platform.md` and `docs/product/evidence-first-halal-status.md` with a short `docs/product/halal-model.md` that restates [§1](#1-product-rules)–[§2](#2-halal-status-the-algorithm). Update the README's Routes table and feature paragraphs.

---

## 13. Testing

Use the Node test runner with `tsx` (as today), `api-smoke.mjs` and `browser-smoke.mjs` (Playwright).

**Unit (`packages/core/tests`)**

- `halal.test.ts`, table-driven:
  - No answers gives `unchecked`.
  - `yes,yes` gives streak 2.
  - `yes,unsure,yes,yes` gives settled (`unsure` is skipped).
  - `no,yes,yes,yes` gives `value=no`, streak 1: the newest wins and the streak resets.
  - A 4th agreeing answer stays capped at 3.
  - All 4 settled gives `verified`.
  - 3 facts settled and 1 with no answer gives `checking` with progress 2 (clamped), not `verified`.
  - Progress is the minimum streak among facts with a value.
- `eligibility.test.ts`: the 24 h rule, latest per user, excluded, suspended.
- `points.test.ts`: one award per day per place, `helped-verify` awarded once, exclusion removes points.
- `filters.test.ts`: chips map to `value`, unknown values are excluded, Verified requires all settled.
- `visibility.test.ts`: the matrix in [§9](#9-privacy-safety-and-abuse) across shared/private/blocked/follower.
- `notifications.test.ts`: dedupe, no notification to the actor, none across a block, like collapsing.

**Repository and route (`apps/web/tests`)** against local D1 (Miniflare)

- Writing a check writes `checks` + `check_dishes` + `place_status` + `points` in one batch, and is idempotent on `idempotencyKey`.
- The third matching check flips the place to `verified`, writes `place_status_changes`, notifies savers and awards `helped-verify`.
- Add place: duplicate → 409 with id; answers → status `checking(1)`.
- A ranked list rejects places the owner hasn't checked.
- Each moderator action changes state and writes the audit log; merge moves every FK and recomputes both places.
- A private account's shared check is hidden from non-followers in feed, profile, notes and friend lines.
- Search caps `q` at 64 characters and returns 4 sections.

**Browser smoke:** sign in → welcome 3 steps → Explore → place → check → Check sent; add a place; follow, like, comment, send a rec, reply; create a plan list, invite, accept; RSVP an event; moderator resets a place.

**Accessibility:** axe via Playwright on every route. Every interactive control is a real `button` or `a` with a label.

---

## 14. Build order

Each phase ends green on `npm run typecheck`, `npm test` and the browser smoke for the flows it touched, and deletes what it replaces.

| Phase | Scope | Done when |
| --- | --- | --- |
| **0. Foundation** | Tokens ([§7.1](#71-tokens)) and components ([§7.2](#72-components)); `TabBar`/`TopBar`/footer; new `schema.ts` + `0001_baseline.sql`; export, reset and seed scripts ([§4.4](#44-reset-and-seed)); `halal.ts` + tests | The app boots on the new schema with seeded places, all `unchecked`. |
| **1. Find & check** | Explore, Search, Cities, Map, Place, How it works, Report, Check, Check sent; `/api/places`, `/api/search`, `checks`, photos, saved; the status projection and the recompute cron | A signed-in user can check a place and see it reach Community verified after 3 eligible accounts. |
| **2. Add** | Add search, confirm, done; Save from a video | A new place goes live with check 1; a video saves a place. |
| **3. Accounts** | Login, Welcome 3 steps, You (Checks tab), Settings, Privacy, Saved (Places), delete account | Onboarding persists; default filters drive Explore. |
| **4. Social** | Follows, blocks, Person, Friends feed, Visit, likes, comments, Inbox, notifications, Send/recs, Invite; friend lines and Friends' picks on Explore and Map | The full social smoke passes; the [§9](#9-privacy-safety-and-abuse) matrix tests pass. |
| **5. Lists & guides** | Saved › Lists, List page (3 kinds), New list sheet, members, list saves, Explore "Guides & lists" row | Plan-list invite, accept and add flows work; the ranked rule is enforced. |
| **6. Community** | Points ledger, Community page, rank on profiles, Passport tab, Events list/detail and RSVP, Explore events row, Creator page | Leaderboard numbers match the ledger. |
| **7. Moderation** | `/admin` Reports + Events, all report actions, audit log | Every action is covered by a route test. |
| **8. Finish** | SEO, sitemap, robots, axe pass, docs ([§12](#12-what-to-delete)), final deletion sweep (`rg` for removed table names returns nothing) | README and `halal-model.md` match the code. |

Phases 4–6 can run in parallel after phase 3.

---

## 15. Decisions taken in this spec

These were open in the design's "What changed" page. They're decided here so the build isn't blocked. Change them here first if you disagree.

1. **Matching is per fact**, using the newest-3 streak rule in [§2](#2-halal-status-the-algorithm). The place is verified when all 4 facts are settled.
2. **Independence** relies on separate accounts, the 24-hour account age, latest-check-only, Turnstile, daily limits and reports. There's no relationship disclosure field.
3. **No data migration.** Only `places` listing rows are carried over.
4. **Ranked lists** only hold places the owner has checked. Plan lists and guides take anything.
5. **Check = visit.** One table. Repeat visits are new rows, and only the latest counts toward status.
6. **List "been" ticks are derived from checks**, not stored. Tapping an unticked item opens the check flow.
7. **Guides are `kind = guide` lists** that only moderators can create, not a separate content type.
8. **Points:** check 3, place added 5, helped verify 10.
9. **Alcohol-led venues stay hidden** by the existing listing rule. "Serves alcohol" is a fact on restaurants, not a reason to hide them.
10. **Dark mode** keeps working through the token table in [§7.1](#71-tokens). The design shows light only.
