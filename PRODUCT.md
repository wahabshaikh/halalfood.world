# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, both confirmed by the user:

**Primary — consumers.** Muslim travelers in unfamiliar cities and local Muslims
in their own city. The traveler arrives phone-in-hand needing halal food nearby
now; the local browses, compares and saves over time. The same surfaces serve
both, so neither speed nor depth can be sacrificed for the other.

**Secondary — contributors.** A smaller committed group that adds places,
submits halal verification evidence, writes reviews, uploads photos and leaves
reactions. `/leaderboard` exists to recognize this group. Their contributions
are the supply side of the product: without them the evidence chain is empty.

## Product Purpose

Help people find halal food anywhere in the world, and let them see *why* a
place is considered halal rather than asking them to trust a badge. Success is a
visitor who finds somewhere to eat and can inspect the basis for the halal claim
before they go.

## Positioning

**An inspectable evidence chain.** Every halal claim on the site traces back to
moderated community evidence with a visible, honest status — `evidence-backed`
when approved verification submissions exist, `unverified` when none have been
reviewed yet. The site never displays a blanket "halal" badge and never presents
itself as a certification authority. A competing directory can copy the map and
the listings; it cannot copy a per-place evidence record with the moderation
history attached.

This is already implemented — see `docs/product/evidence-first-halal-status.md`
for the public status contract.

## Operating Context

- Visitors arrive by map exploration, by search engine to a city or place page,
  or by a shared link to a specific restaurant.
- Consumption is mobile-heavy for travelers, mixed for locals.
- Contribution happens after the fact — someone visits a restaurant, then
  returns to the site to add it or submit evidence.
- Places pages are the shareable unit; city and guide pages are the crawlable
  entry points.
- Authentication is email OTP only (Better Auth + Turnstile). Reading is fully
  public; contributing requires an account.

## Capabilities and Constraints

**Confirmed functionality**

- Full-screen MapLibre GL map at `/` (CARTO Positron tiles, OSM attribution)
  with viewport and search queries, and deep links into cities and places.
- Server-rendered directory: `/cities`, `/city/[citySlug]` (60 per page),
  `/guides`, `/guides/[citySlug]`, `/place/[id]`, `/leaderboard`.
- Per-place community layers: saves, halal reactions, reviews (one per user),
  photos, and halal verification evidence submissions.
- `/add` — authenticated submission via Google Places lookup or manual entry.
- `/saved` — the signed-in user's saved places.
- `/login` — email OTP sign-in behind Cloudflare Turnstile.
- Contributor scoring: places 10, verifications 8, reviews 5, photos 3,
  ratings 1; top 50 shown. Saved places deliberately do not count.

**Technical constraints (properties of the stack, not user commitments)**

- Deployed as a Cloudflare Worker; data in Cloudflare D1 (SQLite) via Drizzle;
  uploads in R2. Node 22.
- Framework is `vinext` (React Server Components), Tailwind v4 + a hand-written
  token layer in `app/globals.css`. Icons from `lucide-react`.
- Google Places (New) calls use deliberately narrow field masks to bound cost.
  Place pages must render fully from the database when Google is unavailable.
- Email via the Resend REST API, low-volume transactional only.

**Terminology**

- *Evidence-backed* / *unverified* are the only two public halal statuses.
- `places.halal_confirmed` is a publication flag, not a public halal status.
- "Verification" means a community evidence submission that a moderator
  approved — never a certification.

## Brand Commitments

None binding. The user explicitly declined to make anything mandatory to
preserve — including the existing green (`#17784a`) / amber palette, the Inter
typography, the map-first `/` layout, and the no-JavaScript fallback behavior.
These remain the incumbent implementation and current design authority, but they
are open to replacement rather than fixed.

The name `halalfood.world` and the evidence-first product position (above) are
product truth and carry forward regardless.

## Evidence on Hand

- Real listing data in D1, seeded and backfilled (`scripts/backfill-*.ts`).
- Real community submissions: verifications, reviews, photos, ratings.
- Written product contract: `docs/product/evidence-first-halal-status.md`.
- Wordmark/brand mark: an inline SVG pin glyph in
  `src/components/site-chrome.tsx`. There is no logo asset file.
- OG image referenced from `src/lib/seo.ts`.

**Absences future work must not fabricate:** there are no testimonials, no press
coverage, no named partner or certification body, no user counts, no pricing,
and no case studies. The site is free and has no commercial tier. Do not invent
any of these as design filler.

## Product Principles

1. **Never overstate halal status.** Truthfulness outranks reassurance. An
   honest "unverified" beats a comforting badge, and "unverified" must never be
   presented in a way that reads as "not halal."
2. **Show the basis, not just the verdict.** Anywhere a status appears, the path
   to the evidence behind it is one step away.
3. **Serve the traveler's urgency and the local's depth on the same surface.**
   Fast to a decision, rewarding to explore.
4. **Contribution is a first-class act, not an afterthought.** Adding a place or
   submitting evidence is the product's supply line and should feel worth doing.
5. **Everything is linkable.** A place, a city, a guide is a URL someone can
   send to a friend and that a search engine can index.

## Accessibility & Inclusion

No specific standard was established by the user. The audience is global and
multilingual in practice, and the product is used one-handed on phones in
unfamiliar places — both are design facts, not confirmed requirements.
