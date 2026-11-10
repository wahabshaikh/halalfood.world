# Launch notes — restaurant claims

Paid plan: **Claim your restaurant**, $29 a month, billed by Whop. Checkout is **off** until `WHOP_OWNER_PLAN_ID` is set. Nothing in this change calls Google Places, and the existing Google search budgets are untouched.

## What changed

- `/claim` explains the plan. `/claim/[placeId]` is checkout, or the owner’s hours, menu, photos, phone, website, description, certificate upload and 30-day view count. The phone, website and description can be saved by the account that claimed as the owner. They show on the place page only after a moderator approves the claim.
- A place page links to “Claim this restaurant”. After a moderator approves a paid claim it shows **Claimed by the restaurant**. That line is not Community verified and not the Muslim-owned badge.
- City pages can show up to four **Sponsored** restaurants in their own block, with `rel="sponsored"`, apart from the place list. They do not change sort order or halal status.
- Certificate photos are filed as pending evidence. A moderator still approves them in Evidence before `certified` can change. Payment does not approve them.
- `/admin` lists paid claims: approve, decline, take down, restore. Each action is audited.
- Responses send `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, a locked-down `Permissions-Policy`, and `Strict-Transport-Security` on public https hosts. HTML also sends a nonce `Content-Security-Policy` (`lib/csp.ts`). Scripts need that nonce (`'strict-dynamic'`). Turnstile, DataFast (`https://datafa.st`), Sentry and the Carto map are allowed. Whop checkout is a navigation to `whop.com`. Styles allow inline rules so MapLibre can position the map. Production builds do not allow `'unsafe-eval'`.

Halal status still comes only from checks and reviewed evidence. `lib/core/halal.ts` does not read these tables.

## Proposed pricing

| Plan | Price | What the buyer gets |
| --- | --- | --- |
| Claim your restaurant | **$29 / 30 days** per place | Owner tools, analytics, and (after approval) the public label plus one Sponsored slot if the city has fewer than four |
| Sponsor a city (already live) | $49 / 30 days | One labelled sponsor card for the whole city. Unchanged. |

The number on the page is `OWNER_CLAIM_PRICE_USD` in `lib/core/owner-claim.ts`. The charge is whatever the Whop plan bills. Those two have to match before checkout is turned on.

Featured cap is `FEATURED_PER_CITY` (4). Claims past the cap keep their tools and label; they wait for a slot.

View counts are approximate: one increment per IP per place per UTC day, no IP stored. Not for billing.

## Env vars

No keys were added in this change. Set these in Cloudflare (production and, separately, Preview). Leave them unset to keep checkout off.

| Name | Required to turn checkout on | Notes |
| --- | --- | --- |
| `WHOP_API_KEY` | yes | Already used by city sponsorships. Company API key that can create checkout configurations. |
| `WHOP_OWNER_PLAN_ID` | yes | `plan_…` for this product. **This is the switch.** Unset → page says “Not available yet”, API returns 503. |
| `WHOP_OWNER_PRODUCT_ID` | no | `prod_…`. Reserved. Not read by the page yet. |
| `WHOP_COMPANY_ID` | no for this plan | Sponsorship inline plans use it. Restaurant checkout uses the plan id, not a new inline plan. |
| `WHOP_WEBHOOK_SECRET` | yes, for activation | Same webhook as sponsorships, `https://<host>/api/webhooks/whop`. Events must include `payment.succeeded`, membership updates and refunds. Metadata `kind` is `owner_claim`. |

Do not put the values in git. Local names are commented in `.dev.vars.example`.

## Migration

`migrations/0012_owner_restaurant_claims.sql` adds `owner_claims`, `owner_hours`, `owner_menu_items`, `place_view_days`, and `place_photos.listed_by` (default `member`). `migrations/0013_owner_place_details.sql` adds `owner_place_details` (phone, website, description). Additive. No backfill.

Workers Builds applies it to the shared preview D1 on push, and to production D1 when this merges to `main` (after the Time Travel bookmark). Restore with the bookmark from that deploy log:

`pnpm exec wrangler d1 time-travel restore DB --bookmark=<bookmark>`

Account deletion keeps the paid claim, clears `contact_email`, and drops `user_id`.

## Checklist for Wahab

- [ ] Confirm **$29 / 30 days** (or change the constant and the Whop plan together before enabling).
- [ ] Create the Whop plan at that price. Set `WHOP_OWNER_PLAN_ID` only when it matches the page.
- [ ] Confirm the public label and the Sponsored block stay **moderator-approved** after payment. The safer default is already what the code does: hours, menu and restaurant photos stay off the public page until that approval. They are not shown just because Whop was paid.
- [ ] Confirm certificate review stays on the existing Evidence queue (payment never sets Halal certified).
- [ ] Confirm the Sponsored cap of **4 per city**, labelled, not mixed into ranking.
- [ ] Confirm view counts are a rough daily total, not a billing meter.
- [ ] Look at the Preview URL for `/claim`, a place page, and a city page.
- [ ] Do not merge until those are accepted. Merging deploys and migrates production.
- [ ] Leave draft PRs #137, #140–#143 and #112 as they are. This branch does not include them.

## Owner contact details

The account that paid and claimed as the owner can save a phone, website and short description on `/claim/[placeId]`. A manager cannot. HTML is stripped, websites must be `http` or `https`, and the phone is 7–15 digits. The place page shows them, and uses them for Call and Website, only after a moderator approves the claim. They are stored on `owner_place_details`, not on `places`, and they do not change halal status.

## Not in this change

- No new payment-provider account, no live charge, no emails, no Whop plan. `WHOP_OWNER_PLAN_ID` stays unset, so checkout stays off.
- No Google Places calls and no change to Google search rate limits or halal-status logic.
- No auto-approval of ownership. That remains a moderation decision.
