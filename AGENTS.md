# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot and others)
working in this repository. Humans are welcome too.

Keep this file short and true. Prefer pointing at the file that is
authoritative (`package.json`, `wrangler.jsonc`, `src/db/schema.ts`, the
README) over copying details that go stale. Package-specific guidance lives in
the nearest `AGENTS.md`: read it before editing that package, and update it in
the same PR when your change makes it wrong.

## What this is

halalfood.world is a trust-first halal food map and community: a Next.js-style
App Router app built with [vinext](https://github.com/cloudflare/vinext) (Next.js
API on Vite), deployed as one Cloudflare Worker with D1 (SQLite) and R2.
Sign-in is Better Auth email OTP behind Cloudflare Turnstile.

## Product rules you must not break

These are decisions, not style. A change that breaks one is a bug even if tests pass.

- **A place's halal status comes only from moderator-approved evidence.**
  Follows, likes, visits, lists, recs, ratings, RSVPs, leaderboard rank and
  creator videos are taste and context; none of them may change or imply a
  halal status.
- **"Unverified" never means "not halal".** Copy must not present it that way.
- **Coordinates are approximate** (city centroid plus jitter). Keep the
  approximate-location note in the UI and `locationPrecision = approximate` in
  JSON-LD.
- **No streaks** or similar compulsion mechanics.
- **Keep the current branding** (name, tandoor-orange theme tokens, icon).
- Private accounts, blocks and a reader's own dietary standard are always
  respected on read (feed, map, lists, recs, leaderboards).
- Server-only secrets never reach the browser: no `NEXT_PUBLIC_` prefix, no
  values in client components, nothing committed.

## Commands

Use Node 22 and npm (see `engines` and `packageManager` in `package.json`).
Run from the repo root; the root `package.json` is authoritative.

| Command | What it does |
| --- | --- |
| `npm ci` | Install (never `npm install` unless you are changing dependencies) |
| `npm run check` | Typecheck and unit tests for every package. Run before every push. |
| `npm run typecheck` | `tsc --noEmit` in each package |
| `npm test` | `node:test` suites via `tsx` in each package |
| `npm run dev` | vinext dev server with local D1/R2 emulation |
| `npm run build` | Production build, staged for Workers Builds |
| `npm run db:migrate:local` | Apply D1 migrations to the local database |
| `npm run test:api` / `npm run test:browser` | Smoke tests against a running server (`TEST_BASE_URL`) |

Run one test file while iterating:

```sh
cd apps/web && npx tsx --test tests/social-feed.test.ts
cd packages/core && npx tsx --test tests/feed.test.ts
```

There is no linter or formatter configured. Match the surrounding code:
two-space indent, double quotes, semicolons, trailing commas.

## Repository map

| Path | What lives there |
| --- | --- |
| `apps/web/app/` | Routes (App Router). `page.tsx` server components, `*-view.tsx` / `*-form.tsx` client components, `api/**/route.ts` JSON handlers |
| `apps/web/src/lib/` | Server-only code: `*-repository.ts` SQL, `api.ts` response helpers, `auth*.ts`, `otp-rate-limit.ts` budgets, `read-cache.ts`, `seo.ts` |
| `apps/web/src/db/` | Drizzle schema (`schema.ts`) and the request-scoped D1 client |
| `apps/web/src/components/` | App-level building blocks shared by pages (`site-chrome`, `section`, `blocks`, `form-fields`) |
| `apps/web/migrations/` | Numbered D1 SQL migrations |
| `apps/web/tests/` | Web tests; `tests/support/sqlite-d1.ts` runs real migrations on `node:sqlite` |
| `apps/web/wrangler.jsonc` | Worker bindings: `DB` (D1), `HALAL_EVIDENCE_R2` (R2), `ASSETS` |
| `packages/core/` | `@halalfood/core`: pure domain rules (no DOM, DB or Worker APIs) |
| `packages/ui/` | `@halalfood/ui`: shadcn/ui components and theme tokens |
| `docs/product/`, `docs/design/` | Product decisions and design boards; read before changing that area |
| `.github/workflows/preview.yml` | Per-PR preview Worker with its own D1 database |
| `.agents/skills/` | Step-by-step playbooks (see below) |

## How a request flows

1. `apps/web/proxy.ts` (Next.js middleware) adds visitor-location headers.
2. A `page.tsx` server component or an `app/api/**/route.ts` handler runs.
3. Pure rules come from `@halalfood/core/<module>`; SQL lives in
   `src/lib/*-repository.ts` and reaches D1 through `database()` from
   `src/db`, which resolves the binding via `cloudflare:workers`.
4. Public, visitor-independent reads may go through `src/lib/read-cache.ts`.
   Anything user-specific is `Cache-Control: no-store`.

Decide where new code goes by what it depends on: no I/O goes in
`packages/core`; SQL goes in a repository; request parsing and status codes stay
in the route.

## Conventions that matter

- **Validate params before SQL.** Use `@halalfood/core/params`
  (`placeIdParam`, `uuidParam`, `citySlugParam`, `pageParam`). A malformed
  segment is a 400/404 that never costs a query.
- **Mutation routes** follow one shape: resolve the session (`requireUser`),
  validate the body (`readJson`), spend a durable rate-limit budget
  (`spendBudget` with a `consume*Limits` function from `otp-rate-limit.ts`),
  then write. Use the helpers in `src/lib/api.ts`; errors are generic and never
  leak database details.
- **Pages** load data through `loadOrDegrade` (`src/lib/load.ts`) so a missing
  row is a real 404 and an outage is a `noindex` "temporarily unavailable" page.
- **Repositories** take an optional `client` argument defaulting to
  `database()` so tests can pass the SQLite stand-in.
- **Rate limits and bounded reads.** Every list query is limit-clamped; every
  write that a user can repeat spends a user and an IP budget. D1 bills rows
  scanned, so check new queries against existing indexes.
- **UI** is composed from `@halalfood/ui/components/*` and Tailwind utilities on
  theme tokens. No hand-written CSS files; prefer token classes (`bg-primary`,
  `text-success`) to raw hex values. Icons come from
  Hugeicons (`@hugeicons/react` + `@hugeicons/core-free-icons`).
- **Imports** inside `apps/web` are relative (see existing routes); packages are
  imported as `@halalfood/core/<module>` and `@halalfood/ui/...`.
- Comments explain why, not what. Keep copy plain and specific.

## Database changes

Migrations are append-only SQL in `apps/web/migrations/NNNN_name.sql`, mirrored
in `apps/web/src/db/schema.ts`. Production applies them with
`scripts/apply-d1-migrations.ts`, which refuses `DROP TABLE` and any rebuild of
`places`, and splits statements with a quote-aware scanner that does not skip
comments (so no quote characters in SQL comments). Use `.agents/skills/add-d1-migration`.

## Verifying a change

Pick the cheapest check that proves the change, then widen:

1. `npm run check` always.
2. Changed a repository or migration: a test using `createTestDatabase()`.
3. Changed a route: a test that calls the exported handler with a `Request`.
4. Changed rendering, routing, bindings or build config: `npm run build`.
5. Changed a user flow: run it in `npm run dev`, or on the PR preview URL the
   preview workflow comments on the PR.

`.agents/skills/verify-change` has the details, including sign-in.

## Skills

Playbooks live in `.agents/skills/<name>/SKILL.md` (`.claude/skills` points at
the same folder). Load the one that matches the task:

- `verify-change`: which checks to run for which change, and how to sign in locally
- `add-api-route`: a JSON route handler with auth, validation, rate limit and tests
- `add-page`: a server-rendered page with metadata, degradation and shared chrome
- `add-d1-migration`: a schema change that is safe for production D1
- `open-pr`: branch, commit, PR description and preview checks

For Cloudflare platform questions, the official
[cloudflare/skills](https://github.com/cloudflare/skills) plugin (enabled in
`.claude/settings.json`) covers Workers, Wrangler, D1, R2 and vinext. Prefer
current docs (Cloudflare docs, Context7) over memory for vinext, Better Auth and
Wrangler, which move fast.

## Git and pull requests

- Never commit to `main`. One focused change per branch and PR.
- Commit subject: an imperative sentence about the user-visible change (see
  `git log`), with a body explaining why when it is not obvious.
- PRs use `.github/pull_request_template.md`. Every PR gets a preview Worker at
  `https://pr-<number>-halalfood-world.wahabshaikh.workers.dev` with its own
  empty D1 database.
- Do not run `db:migrate:remote`, `deploy`, or anything else that touches
  production unless the user explicitly asks.

## Keeping this file useful

When you learn something non-obvious that the next agent would otherwise
rediscover (a gotcha, a decision, a command), add it here or to the nearest
package `AGENTS.md`, in the same PR. Delete lines that stop being true.
