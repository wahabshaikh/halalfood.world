# Contributing

Thanks for helping people find halal food they can trust. Code, bug reports and data fixes are all welcome.

## Set up

You need Node.js 22 (see `.nvmrc`) and pnpm 10.

```sh
pnpm install
pnpm db:migrate:local   # creates the local D1 database
pnpm db:seed:local      # adds a few sample places
pnpm dev                # http://127.0.0.1:5173
```

No Cloudflare account is needed for local work: D1 and R2 run in local simulators, sign-in uses Turnstile's test
keys and a development secret, and emails land in a local sink (`/api/test/emails`). Features that need a
third-party key (Google Places search on /add) are off until you add one to `.dev.vars` (copy
[`.dev.vars.example`](.dev.vars.example)).

## Before you open a pull request

```sh
pnpm verify             # lint, typecheck, unit tests with coverage
pnpm build
pnpm e2e                # the Playwright suite (CI runs it against the production build)
```

Signed-in flows don't need the email code: `pnpm shot /saved --as you@example.com` screenshots pages as a
signed-in person, and specs use `newUser`/`signIn` from `e2e/support/helpers.ts`. See [docs/testing.md](docs/testing.md).

- Read the relevant part of the [spec](docs/spec/README.md) and [architecture](docs/architecture.md). Social
  features never change a place's halal status.
- New migrations go in `migrations/` with the next number and are additive. Never edit one that has been merged:
  merging deploys and migrates production.
- Bindings, environments and deploys are described in [docs/deployment.md](docs/deployment.md). A new binding must
  be added both at the top level of `wrangler.jsonc` and in its `previews` block, pointed at a preview resource.
- Pull requests from this repository get a Worker Preview URL on the preview database. Fork PRs run CI only.

## Project layout

```
app/            vinext App Router: pages, route handlers (app/api), sitemaps
components/ui   shadcn/ui primitives
components/hf   product components
lib/            server logic, one module per area; lib/core holds the pure domain rules; tests sit beside code
tests/          repo-wide audits
worker/         Worker entry
migrations/     D1 SQL migrations (append-only)
seed/           local sample data
scripts/        operational and dev scripts (backfills, listing import, preview migrations, screenshots)
e2e/            Playwright suites; shared helpers in e2e/support
docs/           spec, architecture, deployment, testing, operations, runbooks
design/         design canvas snapshot
```
