# Deployment and environments

halalfood.world is one Cloudflare Worker (`halalfood-world`) built with [vinext](https://github.com/cloudflare/vinext).
It serves pages, the JSON API and auth. Everything it binds is declared in [`wrangler.jsonc`](../wrangler.jsonc).

## Environments

| | Local | Preview | Production |
|---|---|---|---|
| URL | `http://127.0.0.1:5173` | `<branch>-halalfood-world.<subdomain>.workers.dev` | `https://halalfood.world` |
| How | `pnpm dev` | [Worker Previews](https://developers.cloudflare.com/workers/previews/) from Workers Builds on every pushed branch | Workers Builds on every push to `main` |
| Config | top level of `wrangler.jsonc`, local simulators | the `previews` block | top level |
| D1 / R2 | Miniflare, in `.wrangler/state` | `halalfood-world-preview`, `halalfood-world-evidence-preview` (shared by all Previews) | `halalfood-world-v2`, `halalfood-world-evidence` |
| Email | sink (`/api/test/emails`) | sink | [Email Service](https://developers.cloudflare.com/email-service/) from `salam@halalfood.world` |
| Turnstile | test keys | test keys | production keys (secrets) |
| Auth secret | development fallback | development fallback unless set | `BETTER_AUTH_SECRET` (required) |
| Rate-limit namespaces | local | `81101`, `81102`, `81103` | `81001`, `81002`, `81003` |
| `ENVIRONMENT` | `production` (localhost is still non-production) | `preview` | `production` |

`lib/environment.ts` decides whether a request is non-production: localhost, or a `*.workers.dev` host on a
deployment whose `ENVIRONMENT` is not `production`. Non-production turns on the test hooks (`/api/test/session`,
`/api/test/emails`, Turnstile test keys, the development auth secret). The production Worker's own `workers.dev`
and Version URLs have `ENVIRONMENT=production`, so they keep production behaviour.

### What a Preview can and cannot touch

Previews do not inherit anything from the top level, so the `previews` block lists every binding the code reads,
pointed at preview resources. It deliberately has no `send_email` (Previews use the email sink), no routes and no
crons. Previews hold their own secrets, never production's. `lib/wrangler-config.test.ts` fails the build if the
`previews` block ever shares a D1 database, R2 bucket, KV namespace or rate-limit namespace with production, or
gains an email binding, queue, route or cron.

Anyone with a Preview URL can use its test hooks (open a session as any account, read sink mail for an address), so
the preview database must only ever hold test data: never copy production rows into it.

All Previews share one D1 database. Migrations are additive (see [AGENTS.md](../AGENTS.md)), so a PR that adds one
can apply it to the shared database without breaking other Previews.

## Continuous deployment

[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) (the Cloudflare GitHub app) builds every
push. Its commands live in `package.json`, so they are reviewed like code:

| Builds setting | Value | Runs |
|---|---|---|
| Build command | `pnpm build` | build guard → `vinext build` |
| Deploy command (`main`) | `pnpm cf:deploy` | print a D1 Time Travel bookmark → `wrangler d1 migrations apply DB --remote` → `wrangler deploy` |
| Preview command (other branches) | `pnpm cf:preview` | `pnpm db:migrate:preview` → `wrangler preview` (Preview named after the branch) |

The build guard (`lib/build-guard.ts`) stops a Workers Builds run that was not started by pnpm. The settings this
repo used before Worker Previews (`npm run build` then `wrangler versions upload`) would upload a branch as a
version of the production Worker, bound to production D1 and secrets; with the guard they fail before anything is
uploaded.

Builds posts the Preview URL on the pull request. GitHub Actions (`ci.yml`) runs lint, typecheck, unit tests, the
build and the Playwright suite on every PR. Fork PRs run CI only.

### Account setup (applied through the Cloudflare API on Oct 6, 2026)

1. **Email Service**: `halalfood.world` is a sending domain (DKIM `cf-bounce._domainkey`, return path
   `cf-bounce.halalfood.world`, DMARC `p=reject`), and Email Routing forwards `salam@halalfood.world` and
   `support@halalfood.world` to the maintainer's verified inbox (support replaces the old Crisp widget).
   To (re)create the support rule once a destination address is verified:

   ```sh
   pnpm exec wrangler email routing rules create halalfood.world \
     --name "Forward support@" \
     --match-type literal --match-field to --match-value support@halalfood.world \
     --action-type forward --action-value <verified-destination-email>
   ```
2. **Builds**: build `pnpm build`, deploy `pnpm cf:deploy`, Previews on with `pnpm cf:preview`; the legacy
   `wrangler versions upload` trigger was migrated to Previews. The build token is the one mosques.world uses
   (Workers Scripts: Edit, D1: Edit).
3. **Domains**: `halalfood.world` and `www.halalfood.world` are custom domains (declared in `wrangler.jsonc`;
   `www` 308s to the apex in `worker/index.ts`, API included). The production `workers.dev` URL is off; Preview URLs stay on.
4. **Old databases deleted**: the nine `halalfood-world-pr-*` databases from the old preview workflow and the
   pre-cutover `halalfood-world`.

Still to do after this merges and production mail is confirmed: remove the `RESEND_API_KEY` and
`PREVIEW_RESEND_API_KEY` secrets and Resend's DNS records (`send.halalfood.world`, `resend._domainkey`).

## Secrets

Secrets never go in `wrangler.jsonc` or the repo. Locally they go in `.dev.vars` (see
[`.dev.vars.example`](../.dev.vars.example)). Production and Previews hold separate values:

```sh
# Production
openssl rand -base64 32 | tr -d '\n' | pnpm exec wrangler secret put BETTER_AUTH_SECRET

# Every new Preview (base config), and one existing Preview
pnpm exec wrangler preview base-config secret put GOOGLE_PLACES_API_KEY
pnpm exec wrangler preview secret put GOOGLE_PLACES_API_KEY --name my-branch
```

| Name | Production | Preview | Notes |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | required | optional | Non-production hosts fall back to a development secret. At least 32 characters. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | required | not used | Secrets even though the site key reaches the browser: a plain var of the same name would replace the secret. Previews use test keys. |
| `YOUTUBE_API_KEY` | optional | optional | Video paste enrichment: one videos.list and one channels.list call per new video (2 units), cached 30 days. Unset: oEmbed only; publishing needs an existing creator matched by handle. |
| `GOOGLE_PLACES_API_KEY` (or `GOOGLE_MAPS_API_KEY`) | optional | optional | Add-a-place search, and geocoding Scout places sent without coordinates (Text Search, or Place Details for a Google id). Both spend the same daily caps (`GOOGLE_*_DAILY_CAP`); Previews have their own. Unset: Scout stores such places without coordinates. |
| `EMAIL_HEALTHCHECK_ENABLED`, `EMAIL_HEALTHCHECK_TOKEN`, `EMAIL_HEALTHCHECK_TO` | optional | not used | See [operations.md](operations.md#email-healthcheck). |
| `WHOP_SPONSOR_PRODUCT_ID` | optional | optional | Existing `prod_…` for city sponsorships; when unset Whop creates the hidden inline plan without a product id. |
| `WHOP_NEWSLETTER_PLAN_ID`, `WHOP_NEWSLETTER_PRODUCT_ID` | optional | optional | Newsletter `plan_…` and `prod_…` in Whop, with `WHOP_API_KEY` able to create checkout configurations and read user access. The plan id is required to enable `/newsletter` checkout; the optional product id enables product matching and live access checks. Without the plan: page says "Not available yet", API returns 503. Configure the shared webhook above for membership activation and updates. Newsletter content and delivery are managed in Whop. |
| `WHOP_API_KEY`, `WHOP_COMPANY_ID`, `WHOP_WEBHOOK_SECRET` | optional | optional | City sponsorships ([architecture](architecture.md#city-sponsorships-whop)). The API key is a Whop company API key allowed to create checkout configurations; the company id is `biz_…`; the webhook secret is the `ws_…` signing secret of a Whop webhook pointed at `https://<host>/api/webhooks/whop` with `payment.succeeded`, `membership.activated`, `membership.updated`, `membership.deactivated`, `membership.cancel_at_period_end_changed`, `refund.created` and `refund.updated`. Unset: `/sponsor` still renders but checkout answers 503, and the webhook answers 503. Use a separate Whop webhook (and secret) per environment. |
| `MCP_ADMIN_SECRET` | optional | optional | Halal Food Scout's bearer token for `/api/mcp` ([architecture](architecture.md#halal-food-scout-admin-mcp)). At least 32 random characters (`openssl rand -hex 32 \| tr -d '\n' \| pnpm exec wrangler secret put MCP_ADMIN_SECRET`). Unset or shorter: the endpoint answers 503. Use a different value on Previews. Rotate by putting a new value and updating the bot. |

`SENTRY_DSN` is a public var in `wrangler.jsonc`, not a secret: do not also `wrangler secret put` it (a var and a
secret with the same name conflict on deploy). The browser SDK reads `NEXT_PUBLIC_SENTRY_DSN` at build time and
otherwise the same value. Events are tagged with `ENVIRONMENT`.

## Manual commands

```sh
pnpm db:migrate:local      # local D1
pnpm db:seed:local         # local sample places (seed/local.sql); never a migration
pnpm db:migrate:preview    # shared preview D1 (reads previews.d1_databases)
pnpm db:migrate:remote     # production D1, take a Time Travel bookmark first

pnpm deploy:preview        # build + Preview named after the current git branch
pnpm deploy                # build + production (prefer Workers Builds, which also migrates)
```

`vinext build` writes the deployable config to `dist/server/wrangler.json` and points Wrangler at it through
`.wrangler/deploy/config.json`, so `wrangler deploy` and `wrangler preview` must run after a build.

## Rollback

- Code: `pnpm exec wrangler rollback` (or pick a version under **Deployments** in the dashboard). Rolling back to
  a version from before a secret change also drops that secret.
- Data: migrations are additive, so code rollbacks need no data rollback. For data damage, restore the bookmark the
  deploy printed in its build log: `pnpm exec wrangler d1 time-travel restore DB --bookmark=<bookmark>`.
- The Oct 5, 2026 database cutover has its own runbook: [runbooks/d1-cutover-rollback.md](runbooks/d1-cutover-rollback.md).
- Migration 0007's backfill (unverified imported places) has an operator-only data rollback,
  `scripts/rollback/0007_place_provenance_down.sql`, kept outside `migrations/` so no deploy runs it:
  [runbooks/unverified-imports.md](runbooks/unverified-imports.md#rollback).

## Resources

| Binding | Production | Preview |
|---|---|---|
| `DB` (D1) | `halalfood-world-v2` | `halalfood-world-preview` |
| `HALAL_EVIDENCE_R2` (R2) | `halalfood-world-evidence` | `halalfood-world-evidence-preview` |
| `EMAIL` (Email Service) | `salam@halalfood.world` | none |
| `GOOGLE_SEARCH_ANON`, `GOOGLE_SEARCH_USER` | namespaces 81001, 81002 | 81101, 81102 |
| `MCP_WRITE_LIMITER` (Scout writes, 300 per 60 s per token) | namespace 81003 | 81103 |
| `ASSETS` | static files | same |

The pre-cutover database `halalfood-world` is kept untouched for rollback and is bound by nothing.
