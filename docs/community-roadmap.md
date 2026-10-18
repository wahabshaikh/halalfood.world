# halalfood.world: community and trust roadmap (product + engineering spec)

**Status:** proposal for Wahab's review · **Date:** 18 Oct 2026 · **Owner:** Wahab
**Scope:** the next phase after launch: a trust-based, community-run halal food guide where creators, members and
members' own AI tools contribute, and every contribution is logged, weighted and moderated.
**Read with:** [`docs/spec/halal-model.md`](spec/halal-model.md) (halal status engine, unchanged here),
[`docs/architecture.md`](architecture.md), [`docs/spec/simplified-community-spec.md`](spec/simplified-community-spec.md),
and the launch report's P0 list.

> This spec adds to what's already built. It doesn't replace the four-fact halal engine (`lib/core/halal.ts`,
> `place_status`). It adds a trust layer, badges, contributions, enrichment and a public member MCP on top.

---

## 0. TL;DR

1. **Two layers.** The *halal engine* (four facts, settled by 3 matching checks or approved documents) stays the
   source of truth for facts. A new *trust layer* adds badges, a 0–100 trust score and "verified by @x and N more".
   Every contribution feeds it, weighted by who made it.
2. **Every contribution is logged and weighted.** That covers vouches, adds, videos, photos, menus, certificates and
   edits, through one `contributions` log. One member counts once per place. A new account weighs less, and account
   age, accepted history and reports move that weight.
3. **Badges come from proof, not volume.** Creator verified and Community verified need 1+ of each. Halal Certified
   needs a reviewed certificate or an official registry match. Muslim owned needs reviewed owner proof. Serves
   alcohol and Serves pork come from the menu.
4. **Paste a video and you get a creator page plus places.** The server only reads cheap metadata (oEmbed + YouTube
   Data API) and caches it. Members choose the places, or their own AI picks them through the member MCP. MVP makes
   no server-side LLM calls.
5. **Public member MCP (`/api/mcp/member`).** Everything a member can do on the site, their own AI can do with their
   API key. The server only validates. MCP writes are ordinary community contributions, with the same weights,
   limits, points and moderation.
6. **Ship order.** Phase 0 is the no-brainer cleanups (this week). Phase 1 MVP (1–2 weeks) adds vouches, badges,
   trust score, video paste, member MCP and points v2. Phase 2 adds enrichment, owners, certificates and ratings.
   Phase 3 adds discovery and social.

---

## 1. What exists today (read before building)

| Area | Today (main @ 43f64b0) |
| --- | --- |
| Stack | One Cloudflare Worker (vinext/Next App Router on Vite 8), D1 + Drizzle, R2, Better Auth email OTP + Turnstile, Workers Rate Limiting |
| Halal engine | `checks` (4 facts yes/no/unsure + verdict no/okay/liked/loved), `place_status` projection, `place_signals` (certificate/menu/listing, moderator-reviewed docs), `place_claims` (Scout web claims, context only). A check counts once the account is 24 h old, only your latest check counts, and 3 matching answers settle a fact |
| Creators | `creator_profiles` (YouTube only, `platform` CHECK), `creator_verifications` (creator × place × video), `place_media_links`. Creators are ordinary `user`+`profiles` rows with a `.invalid` email (they can't sign in until claimed). Pages: `/u/[handle]`, `/creator/[platform]/[handle]`. Context only, never evidence |
| Admin MCP | `POST /api/mcp`: bearer `MCP_ADMIN_SECRET`, tools `find_place`, `upsert_creator(s)`, `upsert_place(s)`, `add_verification(s)`, `remove_verification`, write limiter 300/60 s (`lib/scout/*`) |
| Social | `profiles` (incl. `invited_by_user_id`), follows, blocks, likes, comments, lists, recs, events, notifications, `/invite/[handle]`, `/friends` feed |
| Points | `points` ledger, kinds `check` 3, `place-added` 5, `helped-verify` 10 (CHECK-constrained, can't be widened without a rebuild), city leaderboard `/community` |
| Moderation | `reports`, `moderators`, `audit_log`, `/admin` (Reports, Evidence, Events) |
| Limits | Per user per day: checks 20, places 10, recs 30, reports 10, comments 100 |
| In flight elsewhere (do not touch) | Engineering Lead: PR #121 scraped listings labelled **Unverified** + noindex + out of sitemap (migration 0007). PR #122 menus as data, `menu_check`, logos (migration 0008). PR #118 Scout geocoder. PR #119 Whop city sponsorships. PR #112 certifiers (registry data) |

Data reality (launch report): 7,677 listed places, all scraped from halalfoodnear.me, 0 `verified`, 3 users.
The trust layer has to make an **Unverified** listing turn trusted through real contributions.

---

## 2. Trust model

### 2.1 Principles

- **Facts and trust stay separate.** The four facts are still decided by `lib/core/halal.ts`. Trust says *how much
  real-world proof stands behind a listing*. Ratings, points, follows and sponsorship never touch either.
- **Contributions are claims, not truth.** Every member action is logged with who, how (web, mcp or scout) and when,
  and it can be reverted. Nothing a single member does can make a place "Halal Certified" or "Muslim owned".
- **Show the people.** Trust is shown as people and proof ("Verified by @wahabshaikh and 10 more", "HMC certificate,
  checked 18 Oct"), not just a number.
- **Weight beats ban.** Low-trust accounts can still contribute. Their contributions count for less and land in review more often.

### 2.2 Member weight (`member_trust`)

Recomputed on every accepted or rejected contribution, and nightly.

| Tier | Rule | Weight `w` |
| --- | --- | --- |
| Restricted | account < 24 h, suspended, or ≥ 3 rejected contributions in the last 30 days | 0 (logged, not counted) |
| New | signed in with verified email, account ≥ 24 h | 0.5 |
| Member | account ≥ 7 days and ≥ 3 accepted contributions at ≥ 2 places | 1.0 |
| Trusted | account ≥ 30 days, ≥ 15 accepted, acceptance rate ≥ 90 %, no upheld reports in 90 days | 1.5 |
| Moderator | in `moderators` | 2.0 |

Modifiers (multiply, floor 0):
- Invite-ring damping: a vouch on a place the *inviter* added, by someone they invited, counts × 0.5 for the invitee's first 30 days.
- Cluster damping: if ≥ 3 accounts vouch for the same place from the same IP /24 (hashed) within 24 h, only the
  highest-weight one counts, and the cluster goes to the queue.
- Owner conflict: a verified owner's vouch on their own place counts 0.
- Creators: a claimed creator account is at least Member tier. Their *video* verification is a separate signal (2.3).

### 2.3 Place trust score (0–100), stored on `place_status`

```
proof     = max( 40 if approved, unexpired certificate,
                 40 if official registry match (certifiers PR #112 / Bot A) )
creator   = min(25, 15 for first distinct creator + 5 per additional creator)
community = min(40, 6 * log2(1 + W))         -- W = Σ w over distinct counted vouchers
                                              --   (W=1→6, 10→21, 100→40: "100 verifiers = more trust")
facts     = +10 if all four facts settled (engine "Verified"), +5 if ≥2 settled
menu      = +5 if an approved menu exists (EL menu PR)
penalties = -10 per open, credible report (cap -30); -15 if any fact disputed; -20 if last 3 counted vouches
            all within 1 h from New-tier accounts (burst)
trust     = clamp(0, 100, proof + creator + community + facts + menu + penalties)
```

Bands, shown as words and never just a number: **0–14 Unverified**, **15–39 Some proof**, **40–69 Trusted**, **70+ Highly trusted**.
Pork found on a menu (`pork=yes` from an approved menu or menu_check) caps trust at 14 and puts the place in review, per
the existing menu rule. Alcohol on the menu doesn't change trust. It sets the Serves alcohol badge and `alcohol=yes`.

### 2.4 Badges (place)

| Badge | Shown when | Source of truth |
| --- | --- | --- |
| **Creator verified** | ≥ 1 `creator_verifications` row | Scout or an accepted video submission. Tap to open the videos |
| **Community verified** | ≥ 1 *counted* vouch (w > 0) | `vouches` via `contributions`. Label: "Verified by @a and N more", full list in a modal |
| **Halal Certified** | an approved, unexpired certificate signal, **or** an official certifier-registry match | `place_signals` (certificate, approved) / registry rows. A Scout web claim alone shows "Web source says certified" as a line, not a badge |
| **Muslim owned** | an approved owner claim with Muslim-owned proof, **or** a moderator-approved proof document | `place_owners`. Community answers alone show as "7 people say Muslim-owned", not a badge |
| **Serves alcohol** | approved menu or menu_check finds alcohol, or the alcohol fact is settled yes | EL menu PR + engine |
| **Serves pork** | the same for pork. It also triggers review (2.3) | EL menu PR + engine |

Unverified scraped listings show no badges until one of these is earned. The EL PR's "Unverified" label stays until trust ≥ 15.

### 2.5 Member badges (profile, gamified)

First vouch · First video (submitted a creator video) · Menu detective (5 accepted menus) · Certificate hunter (3 approved
certificates) · Local guide (25 accepted contributions in one city) · Founding member (first 500 accounts) · Connector
(5 invited friends who contributed). Badges are cosmetic and never change weight.

### 2.6 Anti-gaming checklist

- **Sign-in required** for every write: OTP email plus Turnstile on sign-in. MCP writes need a member API key tied to the account.
- **Account age:** 24 h before anything counts, and 7 days before MCP write keys can be created.
- **One voice per member per place:** a vouch is upserted, and only the latest counts (as with checks).
- **Rate limits per user per day:** vouches 20, place adds 10 (existing), video submits 10, photos 30, menu items 200
  across 10 menus, certificates 5, edits 30, ratings 30. Per IP: 3× the user limits. MCP has the same per-user limits
  plus a per-key burst limiter (60 writes per 60 s). The Workers Rate Limiting binding acts as a burst guard, and D1 counts give the daily quotas.
- **Velocity flags** go to the queue: more than 5 vouches in 10 min, vouches more than 100 km apart within 1 h, or a new
  account adding then self-vouching.
- **Points only for accepted work** (section 4): adds and videos pay once accepted. Vouches pay at once but are revoked if excluded.
- **Moderation queue** for certificates, owner claims, Muslim-owned proof, pork-on-menu, flagged clusters, new places from New-tier accounts, and creator pages from member-submitted videos.
- **Certificate review:** the moderator checks certifier name (matched to a `certifiers` row when possible), place name and
  address match, and expiry date. An expired certificate drops the badge automatically. The certificate image stays private to
  moderators. Only certifier, expiry and "checked DATE" are public.
- **Everything is reversible:** excluding a contribution recomputes trust, badges and points, and writes `audit_log`.

---

## 3. Data model changes

All additive, following the AGENTS.md rules. **New migrations are numbered from `0009` onward** (0007 = PR #121, 0008 = PR #122).
Renumber at merge time if `main` has moved on. Drizzle schema in `lib/db/schema.ts` kept in sync.

| Migration | Tables / columns | Notes |
| --- | --- | --- |
| `contributions` | `id, user_id, kind (vouch, place_add, video, photo, menu, certificate, owner_claim, edit, rating, amenity, hours, link), place_id NULL, ref_table, ref_id, channel (web, mcp, scout), status (pending, accepted, rejected, reverted), weight REAL, ip_hash, api_key_id NULL, created_at, reviewed_by, reviewed_at, reason` | The one audit and points source for community work. No CHECK on `kind`: validated in `lib/core/contributions.ts`, so new kinds need no rebuild (the same pattern as `place_claims`) |
| `vouches` | `user_id, place_id, ate_at (YYYY-MM), rating (disliked, liked, loved) NULL, note ≤ 280 NULL, check_id NULL, created_at, updated_at`, PK `(user_id, place_id)` | "I ate here and it's halal." It's lighter than a check: the four questions are an optional "add details" that writes a normal `checks` row |
| `member_trust` | `user_id PK, tier, weight, accepted, rejected, upheld_reports_90d, updated_at` | Projection (2.2) |
| `place_status` add columns | `trust_score INT DEFAULT 0, trust_band TEXT DEFAULT 'unverified', community_vouchers INT DEFAULT 0, creator_count INT DEFAULT 0, badges TEXT DEFAULT ''` | Recomputed by `recomputeTrust(placeId)` next to the halal recompute |
| `video_submissions` | `id, user_id, platform ('youtube'), video_id, url, status (queued, fetched, needs_places, needs_review, published, rejected), creator_user_id NULL, meta JSON (oEmbed + Data API, cached), place_ids JSON, channel, created_at, updated_at`, unique `(platform, video_id)` | One row per video: later submitters are linked as `contributions` and don't create duplicates |
| `creator_links` | `creator_user_id, kind (youtube, instagram, tiktok, x, website, facebook), url, source (youtube_about, member, scout), created_at`, PK `(creator_user_id, kind)` | "Social presence" on the creator page. `creator_profiles.platform` stays YouTube-only for now |
| `place_links` | `place_id, kind (website, phone, email, whatsapp, instagram, tiktok, facebook, x, youtube), value, source (owner, member, scout, google), submitted_by, status, created_at`, unique `(place_id, kind, value)` | Contact details and socials. `places.telephone`/`website` remain the canonical display values (an owner or moderator promotes them) |
| `place_hours` | `place_id PK, hours JSON (schema.org openingHoursSpecification), source, submitted_by, status, updated_at` | Community or owner hours |
| `place_amenities` | `place_id, amenity (prayer_space, wudu, family_seating, women_section, wheelchair, parking, delivery, takeaway, kids_menu, outdoor), value (yes, no), user_id, created_at`, PK `(place_id, amenity, user_id)` | Majority of counted weights decides what's shown |
| `place_edits` | `id, place_id, user_id, field, old_value, new_value, status, created_at, reviewed_by` | Name, address, pin and closed suggestions. Trusted-tier edits to contact or hours fields are accepted automatically, everything else is queued |
| `place_owners` | `id, place_id, user_id, status (pending, approved, rejected, revoked), role (owner, manager), muslim_owned_claim INT, proof_photo_id NULL, reviewed_by, reviewed_at, created_at` | Owner claims plus Muslim-owned proof. Proof photos go to private R2, deleted 30 days after review |
| `place_signals` add columns | `submitter_role ('visitor','owner') NULL, certifier_id NULL` | Certificates, linked to PR #112's certifiers |
| `contribution_points` | `id, user_id, contribution_id, kind, place_id NULL, city_slug, points, status (pending, granted, revoked), day, created_at` | Points v2 (the old `points` CHECK can't widen). The leaderboard sums `points` + granted `contribution_points` |
| `member_badges` | `user_id, badge, awarded_at`, PK `(user_id, badge)` | Section 2.5 |
| `member_api_keys` | `id, user_id, name, prefix (first 8), key_hash (SHA-256), scopes ('read','write'), last_used_at, created_at, revoked_at` | Member MCP. The key is shown once and never stored in plain text |
| `profiles` add columns | `maps_app ('google','apple','auto') DEFAULT 'auto'` | Directions preference, kept in localStorage for signed-out visitors |

Menus and logos: **owned by EL PR #122** (menu storage, `menu_check`, `places.logo_key`). This spec only *feeds* them
(menu photo upload → extraction → EL's menu table) and reads `menu_check` for the alcohol and pork badges.

---

## 4. Points and gamification

| Action | Points | Paid when | Cap |
| --- | --- | --- | --- |
| Vouch (ate here) | 3 | at once. Revoked if excluded | 1 per place per member, ever |
| Add details (4-fact check) | +2 on top of the vouch | at once | existing once-per-day rule |
| Add a place | 5 | after its first *independent* counted vouch, or approval | 10 a day |
| Submit a creator video | 5, +2 per place published from it | on publish | 10 a day |
| Photo | 1 | at once. Revoked on removal | 10 a day |
| Menu (photo or structured) | 5 | on acceptance | 5 a day |
| Halal certificate | 10 | on approval | 5 a day |
| Owner claim approved | 10 | on approval | — |
| Hours, links or amenities edit accepted | 1 each | on acceptance | 20 a day |
| Helped verify (engine) | 10 | existing rule | — |
| Invite: friend's first accepted contribution | 5 | on that contribution | 10 friends a month |
| Rating | 0 | — | Ratings never pay, so there's no farming |

- Daily earning cap is 100 points. Points have no cash value and never affect trust weight, ranking or status.
- Levels shown on profiles: Newcomer (0), Explorer (50), Guide (200), Local legend (750), Halal hero (2,000).
- Streaks: "3 weeks in a row with a contribution" flair on the profile. Cosmetic only.
- MCP contributions earn exactly the same as web ones (the `channel` field is informational).

---

## 5. Key user flows

### 5.1 Paste a video (web, `/add/video`, which already exists as "save from a video")
1. A member pastes a YouTube Short or video URL. The server parses the `video_id` (no fetch if it's already in
   `video_submissions` with meta cached).
2. Fetch 1 is YouTube oEmbed (free, no key): title, author name, author URL, thumbnail. Fetch 2 is YouTube Data API
   `videos.list` (1 unit): channelId, description, publishedAt. Then `channels.list` (1 unit): handle, avatar, banner,
   subscribers, plus links parsed from the channel description. All of it is cached in `meta`, and nothing is re-fetched for 30 days.
3. Creator: match `creator_profiles` on channel_id, or create one with the same code path as Scout `upsert_creator`
   (unclaimed `.invalid` user) plus `creator_links`.
4. Places: the server suggests candidates *without an LLM*. It matches description lines against existing places in the
   creator's likely city (`place-match.ts`), and the member confirms or picks from Google search (the existing Add flow,
   which is budget-guarded). The member chooses the timestamp per place (optional).
5. The result is `creator_verifications` rows (source `member`) + `contributions` (kind `video`). New-tier submitters'
   creator pages and verifications go to review. Member tier and above publish at once.
6. The place page shows "Creator X verified this" with the video embedded (youtube-nocookie, lazy).
   The member's own AI can do steps 4–5 through the MCP (section 7), so extraction costs fall on them.

### 5.2 Add or vouch a place
- **Existing place:** the place page's primary action becomes "I ate here" (one tap, then optional rating, month,
  note and "add details" for the four questions). The result is a `vouches` row + a `contributions` row.
- **New place:** the existing Google-result Add flow. New-tier → `pending` (closes launch P0 #6). Member and above →
  live with the Unverified label.
- Display: "Verified by @wahabshaikh and 10 more". Avatars stack 3, and a modal lists everyone, Trusted first,
  respecting private accounts and blocks (the private ones count but show as "and 2 private members").

### 5.3 Enrich a place
Place page, "Improve this place" sheet: photos · menu photos · hours · phone, website, email and socials · amenities ·
"something's wrong" (edit). Each item is a small form, and each one gives a points toast.
Menu photos: stored → (Phase 2) vision OCR runs **only** on uploaded menu photos, cached by image SHA-256, capped
per day, and feeding the EL menu table → `menu_check` → alcohol and pork badges. Rule: photos the member took, or
pages that are the restaurant's own or openly public. No Zomato, Swiggy or Google Maps scraping (the upload form says so).

### 5.4 Upload a halal certificate
Place page → "Add halal certificate" → photo plus optional certifier (autocomplete from `certifiers`) and expiry, plus
"I'm a visitor / I'm the owner". It goes into the queue. Once approved the place gets the Halal Certified badge, and
"Certified by HMC · checked 18 Oct · expires Mar 2027" shows on the card and the page.

### 5.5 Rate
In the vouch sheet: **Astaghfirullah** (didn't like), **Alhamdulillah** (liked), **MashaAllah** (loved), each with an emoji
and an English subtitle. The place page shows the counts. Existing `checks.verdict` maps no→disliked, okay/liked→liked,
loved→loved for display. Ratings are taste only.

### 5.6 Invite friends and see their activity
`/invite/[handle]` exists. Add a "Invite friends" sheet (copy link + WhatsApp share) on `/me` and after each
contribution. The Friends feed shows vouches, videos and certificates from people you follow ("Aisha ate at X · MashaAllah"),
and on a place page friends' vouches come first: "2 friends ate here".

### 5.7 Profiles
`/u/[handle]`: avatar, level, member badges, counts (places vouched, videos, menus, certificates), a contributions tab,
cities, invite link. Creator profiles add channel, socials and "Verified in videos". Private accounts follow existing rules.

### 5.8 Discover
Explore gets tabs or chips: Places (default) · Creators (most-verified places in this city) · Foods (dish chips from
`check_dishes` and menus) · People (top contributors this week). Every card shows its badges and the trust band.

---

## 6. UX and design principles, page list

Principles:
1. **One primary action per screen.** On a place page it's "I ate here". Everything else lives in "Improve this place".
2. **Proof before praise.** Badges and "who verified" sit above photos and ratings. "Unverified" is plain, never alarming.
3. **Words, not scores.** The trust band is a word with a tooltip that explains how it's computed. No raw 0–100 on cards.
4. **Fast, fun feedback.** Points toasts, badge unlock sheets, progress ("2 more vouches to Trusted").
5. **Remove clutter.** No empty sections (hide a section that has no data). Use one city-name formatter and one address format
   (area, city). Avoid duplicate CTAs.
6. **Respect preferences.** Directions open Google or Apple Maps per preference, the default filters persist, and dark mode follows the system.
7. **Mobile first at 360 px.** No horizontal scroll and tap targets ≥ 44 px.

Pages (new ★, changed ✎):
- ✎ `/place/[id]`: badges row, trust band, "Verified by…" with modal, creator videos, ratings, "I ate here", "Improve this place", hours, amenities, links, directions chooser.
- ✎ `/add`, `/add/video`: video paste flow (5.1).
- ✎ `/u/[handle]`: level, badges, contributions.
- ✎ `/community`: leaderboard on contribution points, plus "new creators" and "new members".
- ★ `/creators`: creator directory by city.
- ★ `/connect`: "Connect your AI", with MCP setup for Claude, ChatGPT and Cursor, key management.
- ★ `/me/keys` (could be part of `/me/settings`): API keys.
- ★ `/how-trust-works`: badges, trust bands, points (replaces the How verification works sheet's long copy).
- ✎ `/admin`: queue tabs (section 8).
- (P0 elsewhere) `/privacy`, `/terms`, `/about`.

---

## 7. Public member MCP

**Principle:** anything a member can do on the site, their own AI can do through MCP under their account. The server
does cheap, deterministic validation only, with no LLM calls. Contributions arriving over MCP are ordinary community
contributions: the same `contributions` log, weights, limits, points and moderation, with `channel='mcp'` and `api_key_id`.

- **Endpoint:** `POST /api/mcp/member` (Streamable HTTP, stateless, same SDK and patterns as `lib/scout/mcp.ts`).
  It's separate from the admin `/api/mcp`, with no shared code paths for auth or tools. The code lives in `lib/member-mcp/`.
- **Auth:**
  - Read tools: anonymous allowed, limited to 60 req/min per IP and 10 results max per call.
  - Write tools: `Authorization: Bearer hf_live_<32 random>`. The key is created on `/connect` (account ≥ 7 days,
    up to 3 keys, scopes read or read+write), stored as SHA-256 and shown once. Revoking it takes effect immediately.
  - Phase 2: OAuth 2.1 (Better Auth OAuth provider plugin) for one-click Claude and ChatGPT connectors.
- **Tools:**

| Tool | Kind | Input | Server does |
| --- | --- | --- | --- |
| `search_places` | read | q, city?, near{lat,lng}?, filters? | the same query as `/api/search` and `/api/places`, max 10 |
| `get_place` | read | id or URL | public place view: facts, badges, trust band, creators, links (no private data) |
| `get_creator` | read | handle or channel URL | creator page data + verified places |
| `resolve_place_link` | read | Google Maps / Apple Maps / website URL | parse ids and coords, match an existing place, never call Google |
| `whoami` / `my_contributions` | read (key) | — | the member's tier, limits left today, recent contributions with status |
| `submit_video` | write | url, creator{channel_id?, handle?}, places[{place_id? or name+address+lat/lng, timestamp_s?}] | parse the video id, oEmbed check that the channel matches, dedupe, `video_submissions` + contributions |
| `submit_place` | write | name, address, lat/lng, google_place_id?, website?, source_url | schema + geo sanity + content-rule filter + dedupe (`place-match.ts`) → pending or live per tier |
| `verify_place` | write | place_id, ate_at?, rating?, note?, facts? | the vouch upsert (5.2) |
| `rate_place` | write | place_id, rating | updates the vouch rating |
| `add_menu` | write | place_id, source_url **or** photo_upload_id, items[{name, section?, price?, contains_alcohol?, contains_pork?}] | source-URL allowlist rule (the restaurant's own domain or open public page, blocklist of Zomato, Swiggy and Google domains), size limits, then the EL menu table as `pending` |
| `request_upload` | write | place_id, kind (photo, menu, certificate), content_type, bytes | returns a one-time R2 upload URL (8 MB, jpeg/png/webp) |
| `submit_certificate` | write | place_id, upload_id, certifier?, expires_at?, role | the moderation queue |
| `suggest_edit` | write | place_id, field, value, source_url? | `place_edits` / `place_links` / `place_hours` / `place_amenities` |

- **Limits:** the same daily per-user quotas as the web (2.6), plus a per-key burst limit of 60 writes per 60 s. Each tool
  returns `limits_remaining`. Bodies are at most 64 KB.
- **Errors:** clear JSON (`rate_limited`, `needs_review`, `duplicate` with the existing id, `invalid_source`).
- **Docs:** `/connect` page plus `docs/member-mcp.md`. The server `instructions` string tells AIs the rules:
  "Only submit data the member saw or that comes from the restaurant's own or open public pages. Never scrape Zomato,
  Swiggy or Google Maps. Contributions are reviewed."
- **Cost:** no LLM on our side, no Google Places calls from MCP (members' AIs give coordinates), and YouTube metadata cached per video.

---

## 8. Admin and moderation

`/admin` queue tabs (existing Reports + Evidence, plus the new ones). Each item has approve, reject (with reason) or
"needs info", and every action writes `audit_log` and recomputes trust, badges and points.

| Queue | What lands here | SLA target |
| --- | --- | --- |
| Places | new places from New-tier members, content-rule hits | 48 h |
| Videos | submissions from New tier, channel mismatch, creator not in the halal-food niche | 72 h |
| Certificates | all | 72 h |
| Owners | all owner claims + Muslim-owned proof | 7 d |
| Menus | pork found, OCR low confidence, non-allowlisted source | 72 h |
| Flags | velocity, IP-cluster and burst flags (2.6) | 72 h |
| Reports | existing | 48 h |

Moderator tools: bulk approve, "exclude all contributions by user", "recompute place", per-member history view,
and a daily digest email to Wahab (counts per queue). The admin MCP (`/api/mcp`) gains `list_queue` and `review_item` later so
a bot can triage, with a human approving certificates and owners.

---

## 9. Phased plan

### Phase 0: no-brainers (this week, see backlog section 10a)
Small, safe cleanups that need no product decision.

### Phase 1: MVP (≈ 1–2 weeks)
Goal: a member or their AI can vouch for a place, paste a video and see badges, trust and "verified by…".
Order: P1-1 → P1-2 → P1-3 → P1-4 → (P1-5 ∥ P1-6 ∥ P1-7) → P1-8 → P1-9 → P1-10.

### Phase 2: enrichment and proof (≈ 2–4 weeks after MVP)
Menu photo OCR, hours, amenities, links, edits, owner claims, Muslim-owned proof, certifier linking, OAuth for MCP,
ratings rename everywhere, member badges and levels.

### Phase 3: discovery and social (later)
Creators directory, Foods discovery, friends' activity in Explore, weekly digest email and newsletter (Whop), seasons and
challenges, creator claim flow, Instagram and TikTok creators.

---

## 10. Backlog (PR-sized)

Tags: **NO-BRAINER** = safe, obvious, reversible, no product or policy decision. **NEEDS-REVIEW** = trust or anti-gaming rules,
points economics, moderation, certificates, auth, data policy, pricing or deletion. Each item is one PR.

### 10a. Phase 0: no-brainers

| ID | Item | Tag | Acceptance criteria |
| --- | --- | --- | --- |
| N-1 | Serve `/favicon.ico` | NO-BRAINER | `GET /favicon.ico` → 200 image (or 308 to `/favicon-32.png`). Test covers it |
| N-2 | One city-name formatter, with acronyms | NO-BRAINER | `lib/place-view.ts` and `lib/seo.ts` share one `cityName`. "washington-dc" → "Washington DC", "new-york-city" → "New York City". Unit tests |
| N-3 | Cards show area and city, never a bare postcode | NO-BRAINER | `areaOf` skips postcode-only or "Region 400001" parts and falls back to the city name. Unit tests for Mumbai, London and US samples |
| N-4 | Directions chooser: Google or Apple Maps, remembered | NO-BRAINER | The place page Directions button offers Google Maps / Apple Maps (from lat/lng + name, with `maps_url` fallback). The choice persists in localStorage, and Apple is the default on iOS. No server change. Test for the URL builder |
| N-5 | A real `<h1>` on home and city pages | NO-BRAINER | Exactly one `h1` on `/` and `/city/[slug]` ("Halal food in {City}"), with no visual regression (it reuses the existing heading style or is visually hidden). Test or E2E assertion |
| N-6 | Multi-word search ("mumbai biryani") | NO-BRAINER | A query whose words include a known city name searches that city for the remaining words. "mumbai biryani" returns Mumbai places matching biryani, with no 5xx for long queries. Unit tests |
| N-7 | Hide empty sections on the place page | NO-BRAINER | Sections with no data (photos, videos, notes, dishes) aren't rendered (no empty placeholders), except the primary "check" CTA |
| N-8 | Public read-only member MCP: `search_places`, `get_place` | NO-BRAINER | `POST /api/mcp/member` with 2 read tools, anonymous, IP rate-limited, max 10 results, public fields only. Separate from `/api/mcp`. Tests. Write tools absent |
| N-9 | `docs/member-mcp.md` + `/connect` stub page (read tools only) | NO-BRAINER | Page explains how to add the MCP URL to Claude, ChatGPT and Cursor. Linked from the footer. noindex until write tools ship |
| N-10 | Fix "Washington Dc"-style casing in `/community` city chips | NO-BRAINER | Covered by N-2 (the same formatter). Snapshot test |

### 10b. Phase 1: MVP

| ID | Item | Tag | Acceptance criteria |
| --- | --- | --- | --- |
| P1-1 | Migration: `contributions`, `vouches`, `member_trust`, `place_status` trust columns, `contribution_points` | NEEDS-REVIEW (data model) | The migration applies locally and in preview. Schema is in sync. No existing reads change |
| P1-2 | `lib/core/trust.ts`: member weight + place trust + badges, pure | NEEDS-REVIEW (trust rules) | Implements 2.2–2.4 exactly. Unit tests for every tier, modifier, band and the pork cap. 100 % branch coverage |
| P1-3 | `recomputeTrust(placeId)` wired into check, vouch, evidence and creator writes + one-off backfill script | NEEDS-REVIEW | After a vouch, `place_status.trust_*` updates in the same request. The backfill is idempotent and dry-run by default |
| P1-4 | "I ate here" vouch API + sheet | NEEDS-REVIEW (anti-gaming) | `POST /api/places/[id]/vouch` (session, 20 a day, 24 h age), upsert, contribution logged, 3 points. The sheet has a rating and optional details |
| P1-5 | "Verified by @x and N more" + modal | NO-BRAINER (once P1-4 merges; display only) | Respects private and blocked users. Trusted first. Works with 0, 1, 2 and 100 vouchers |
| P1-6 | Badges row on the place page and cards | NEEDS-REVIEW (badge rules) | Badges render from `place_status.badges`. No badge on Unverified places without proof. a11y labels |
| P1-7 | Video paste v1: oEmbed + Data API, creator upsert, member picks places | NEEDS-REVIEW (moderation + API key cost) | Paste → creator page exists with avatar and socials → chosen places get Creator verified. Meta cached. ≤ 3 YouTube API units per new video. New-tier submissions queued |
| P1-8 | Member API keys (`member_api_keys`, `/me/keys`) | NEEDS-REVIEW (auth) | Create (shown once), list (prefix only), revoke. SHA-256 at rest. 7-day age gate. Max 3 |
| P1-9 | Member MCP write tools: `verify_place`, `rate_place`, `submit_video`, `submit_place`, `whoami`, `my_contributions` | NEEDS-REVIEW (auth + anti-gaming) | Each calls the same service function as the web route. Same limits, points and queue. Contract tests per tool. No LLM or Google calls |
| P1-10 | `/admin` queues: Places, Videos, Flags | NEEDS-REVIEW (moderation) | Approve or reject with a reason, audited, recompute. Velocity and IP-cluster flags created |
| P1-11 | Leaderboard on contribution points v2 | NEEDS-REVIEW (points) | `/community` sums the old `points` + granted `contribution_points`. Pending points aren't shown |
| P1-12 | `/how-trust-works` page | NO-BRAINER (copy follows the approved rules) | Explains badges, bands and points in plain words. Linked from badges |

### 10c. Phase 2

| ID | Item | Tag | Acceptance criteria |
| --- | --- | --- | --- |
| P2-1 | Certificate upload v2: certifier autocomplete (PR #112), visitor/owner role, expiry badge drop | NEEDS-REVIEW (certificates) | Expired certificate → badge gone the next day (cron). Image private |
| P2-2 | Owner claims + Muslim-owned proof (`place_owners`) | NEEDS-REVIEW (policy, PII) | Proof deleted 30 days after review. Owner badge. An owner's vouch weighs 0 on their own place |
| P2-3 | Menu photo → OCR (vision, capped, cached by hash) → EL menu table | NEEDS-REVIEW (cost, data policy) | ≤ N calls a day (config). Same hash never re-billed. Pork → queue. Alcohol → badge |
| P2-4 | `add_menu`, `request_upload`, `submit_certificate`, `suggest_edit` MCP tools | NEEDS-REVIEW | Source allowlist and blocklist enforced. Tests |
| P2-5 | Hours, links and amenities forms + tables | NEEDS-REVIEW (auto-accept rule) | Trusted auto-accept for contact and hours, others queued. The place page shows "Open now" |
| P2-6 | Place edit suggestions (`place_edits`) | NEEDS-REVIEW | The queue shows a diff. Approve applies the change and audits it |
| P2-7 | Ratings rename (Astaghfirullah / Alhamdulillah / MashaAllah) across UI | NEEDS-REVIEW (copy + 4→3 mapping) | All verdict displays use the new labels. Old data mapped. Search for "loved", "liked" etc. passes |
| P2-8 | Member badges + levels on profiles | NEEDS-REVIEW (points) | Badges awarded idempotently. Unlock sheet |
| P2-9 | OAuth 2.1 for the member MCP | NEEDS-REVIEW (auth) | Claude and ChatGPT connectors connect without pasting a key. Scopes. Revocable |
| P2-10 | Invite sheet + "friend's first contribution" points | NEEDS-REVIEW (points, invite-ring damping) | Damping per 2.2. Cap of 10 a month |
| P2-11 | Directions preference saved on the profile (`profiles.maps_app`) | NO-BRAINER | Signed-in preference syncs across devices. localStorage fallback |

### 10d. Phase 3

| ID | Item | Tag |
| --- | --- | --- |
| P3-1 | `/creators` directory per city | NO-BRAINER (read-only) |
| P3-2 | Foods discovery from dishes and menus | NO-BRAINER (read-only) |
| P3-3 | Friends' activity in Explore and "2 friends ate here" | NEEDS-REVIEW (privacy) |
| P3-4 | Creator claim flow (prove channel ownership via a code in the channel description) | NEEDS-REVIEW (auth) |
| P3-5 | Weekly digest / Whop newsletter tie-in | NEEDS-REVIEW (email consent, pricing) |
| P3-6 | Seasons and challenges ("Ramadan iftar hunt") | NEEDS-REVIEW (points) |
| P3-7 | Instagram and TikTok creators (needs a `creator_profiles` platform rebuild) | NEEDS-REVIEW (data model, ToS) |
| P3-8 | Admin MCP `list_queue` / `review_item` for bot triage | NEEDS-REVIEW (moderation) |
| P3-9 | Directory-only nav (launch P0 #7: hide Friends, leaderboard and Events while empty) | NEEDS-REVIEW (product) |

---

## 11. Cost controls (tokens and APIs)

- **No server LLM in MVP.** Extraction is done by the member (UI) or the member's AI (MCP). Halal Food Scout stays the only
  bot that uses an LLM, and it runs on Wahab's budget, not per request.
- **YouTube:** oEmbed (free) first, then Data API `videos.list` + `channels.list` (2 units of the 10,000/day free quota) only for new
  videos. `video_submissions.meta` is cached for 30 days. Transcripts aren't fetched (there's no ToS-clean cheap path). Use the description instead.
- **Vision OCR (Phase 2):** only on uploaded menu photos, deduped by SHA-256, daily cap, small model, and the result is stored.
- **Google Places:** the existing budget guard. MCP never calls Google.
- **D1:** trust recompute is per place, on write only. Reads use the projection columns. No per-request aggregation.

---

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Sybil or vouch farms inflate trust | Log-scaled community score, weights, damping, flags, points only for accepted work. Badges that matter (Certified, Muslim owned) need human-reviewed proof |
| Confusing two "verified" ideas (engine Verified vs Community verified badge) | Decision D1. One `/how-trust-works` page |
| Moderation load outgrows Wahab | Tiered auto-accept, queue SLAs, bot triage later (P3-8), daily digest |
| Legal: scraped data, menus from aggregators | Menus only from own or open sources (enforced allowlist and blocklist). Scraped listings stay Unverified + noindex (EL PR). MCP instructions state the rule |
| Defamation or false "Serves pork" claims | Pork → review before showing. Owners can dispute through a report |
| PII in certificates and owner proof | Private R2, moderators only, auto-delete owner proof after 30 days |
| YouTube quota or API ToS | Cache, oEmbed first, stay well under 10k units. Don't store transcripts |
| MCP abuse (bulk writes) | Keys tied to accounts ≥ 7 days, per-key burst limit + daily quotas, revocation, MCP contributions visibly tagged in admin |
| Merge conflicts with EL PRs | Phase 0 avoids badges, labels, noindex, sitemap and menus. Phase 1 rebases on EL PRs first |

---

## 13. Open decisions for Wahab (each with a recommendation)

1. **What does "Verified" mean?** The engine's place-level "Verified" (all four facts settled by 3 people or documents)
   clashes with the new "Community verified (1+)" badge.
   *Recommendation:* keep the engine unchanged and rename its place-level state to **"Confirmed"**. "Community verified" becomes the 1+ vouch badge with "and N more".
2. **Muslim-owned proof standard.**
   *Recommendation:* the badge only comes from an approved owner claim (moderator-reviewed document or call, proof deleted after
   30 days). Community answers show as "N people say Muslim-owned" text, never the badge.
3. **New places from new accounts: pre-publish moderation or instant?** (Launch P0 #6.)
   *Recommendation:* New-tier → pending. Member and above → instant, but labelled Unverified with no badges until proof arrives.
4. **Points economics.**
   *Recommendation:* the table in section 4: adds and videos pay only once accepted or independently vouched, a daily cap of 100,
   no cash value, ratings pay nothing. Revisit after 30 days of data.
5. **Member MCP auth for writes.**
   *Recommendation:* API keys first (MVP, 7-day account age, read+write scopes, max 3), OAuth 2.1 in Phase 2 for one-click
   Claude and ChatGPT connectors. Read tools stay anonymous with IP limits.
6. **Any server-side LLM for the web video flow?**
   *Recommendation:* none in MVP (oEmbed + Data API + the member picks the places). Phase 2 may add a description-only extraction with a
   small model, cached per video and capped per day, if web submission drop-off at "pick places" is above 50 %.
