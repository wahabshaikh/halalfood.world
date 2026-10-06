# AGENTS.md

Instructions for coding agents (Claude Code, Codex, Cursor, Copilot, …) and humans working in this repo.
Keep this file short and true. When a rule here turns out wrong, fix the rule in the same PR.

## What this is

halalfood.world is a community halal food guide: people who eat somewhere answer four questions about it, and a
place is **Community verified** once those answers agree. It is one Cloudflare Worker:
[vinext](https://github.com/cloudflare/vinext) (the Next.js App Router API on Vite) with D1, R2, Email Service,
Rate Limiting, Turnstile and the Workers Cache. Its sibling project [mosques.world](https://github.com/wahabshaikh/mosques.world)
uses the same stack, layout and workflow.

[`docs/spec`](docs/spec/README.md) is the source of truth for product rules and the halal status algorithm, and
[`docs/architecture.md`](docs/architecture.md) for routes, the API, limits and auth. Read the relevant part before
changing behaviour, and update it in the same PR when behaviour changes. Environments, bindings, secrets, deploys and
rollback are in [`docs/deployment.md`](docs/deployment.md); human contributor setup is in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Commands

pnpm only (never npm or yarn). Node 22.

| Task | Command |
| --- | --- |
| Install | `pnpm install --frozen-lockfile` |
| Dev server (http://127.0.0.1:5173) | `pnpm db:migrate:local && pnpm db:seed:local && pnpm dev` |
| Lint + typecheck + unit tests with coverage gate | `pnpm verify` |
| Unit tests (one file) | `pnpm exec vitest run lib/core/halal.test.ts` |
| Build | `pnpm build` |
| E2E (starts the dev server itself) | `pnpm e2e` (add `--project=chromium` in sandboxes) |
| E2E against the production build, as CI does | `E2E_BUILD=1 pnpm e2e` |
| E2E against a deployment | `PLAYWRIGHT_BASE_URL=https://… pnpm e2e:smoke` |
| Signed-in screenshots of a page | `pnpm shot /saved --as a@example.com [--mobile] [--dark]` |
| Signed-in session for curl or Playwright | `pnpm auth:session --email a@example.com [--moderator]` |
| Local D1 migrations / sample data | `pnpm db:migrate:local` / `pnpm db:seed:local` |

[`docs/testing.md`](docs/testing.md) is the full reference for these.

Local secrets go in `.dev.vars` (copy `.dev.vars.example`); everything works without them, including sign-in,
except features that need a third-party key (Google Places).

Formatting: Prettier is installed but the repo has no formatting baseline yet, so do **not** run
`pnpm format` across the repo. Match the surrounding style (2 spaces, double quotes, semicolons,
long lines are fine).

## Verify before you push

Run these and fix what fails. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the
same in its `check` job, plus the E2E suite against the production build in its `e2e` job:

```sh
pnpm verify && pnpm build
```

Then prove the change works, not just that it compiles:

- `lib/` logic: a Vitest test next to the file (`lib/foo.ts` → `lib/foo.test.ts`). The coverage gate is a ratchet
  in `vitest.config.ts`: never lower it.
- A page, route or flow: run `pnpm e2e` (or the folder that covers it), and look at it with `pnpm shot`.
- Signed-in tests don't go through the sign-in UI: `POST /api/test/session` (or `newUser()` / `signIn()` in
  [`e2e/support/helpers.ts`](e2e/support/helpers.ts)) opens a real session. Only the sign-in flow itself uses the
  email sink (`GET /api/test/emails?to=`). Both 404 in production.
- Say in the PR what you ran and what you did **not** verify (for example "E2E not run: needs Google
  Places key"). Never claim a check passed that you did not run.

## Repo map

```
app/                 vinext App Router: pages, app/api/**/route.ts JSON handlers, sitemaps
  api/auth/[...all]  Better Auth handler (email codes, Turnstile, durable limits)
  api/test/          non-production-only test hooks (session, email sink)
components/ui/       shadcn/ui primitives (restyle via tokens in app/globals.css, don't fork logic)
components/hf/       product components (kit, sheets, app shell, nav)
lib/                 server logic, one module per concern, tests beside the code
  core/              pure domain rules (halal status, checks, people, points, params): no DOM, D1 or Worker imports
  db/                Drizzle schema (keep in sync with migrations/) and database()
  environment.ts     isNonProductionHost() / linkBase(): the only place that decides "is this production?"
  worker-env.ts      readBinding() / readWorkerEnv() / isNonProductionRequest()
  testing/           Vitest stand-ins for cloudflare:workers and D1
tests/               repo-wide audits (query visibility, login links, map canvas)
worker/index.ts      Worker entry: vinext fetch wrapped in Sentry and the public cache
proxy.ts             request headers (visitor location), AI-crawler tracking
migrations/          hand-written D1 SQL, numbered, append-only
seed/local.sql       sample places for local dev and E2E (never applied remotely)
e2e/                 Playwright: auth/, smoke/ (production-safe, @smoke), support/helpers.ts
scripts/             ops and dev scripts (tsx): backfills, listing import, preview migrations, shot, dev-session
docs/                spec/, architecture, deployment, testing, operations, runbooks/, plans/
design/              design canvas snapshot (reference only, not app code)
```

## Rules that keep production safe

These are hard rules.

1. **Migrations are additive.** No `DROP`/`RENAME` of anything deployed code still reads. Expand, migrate,
   contract across at least two releases. Merging applies them to production automatically (`pnpm cf:deploy`).
2. **URLs are permanent.** The site is live and indexed: never remove a route; a renamed route gets a 308.
3. **Fact keys and status values are stable strings** (`owned`, `certified`, `pork`, `alcohol`; `verified`,
   `checking`, `unchecked`): add, never repurpose.
4. **Social signals never change halal status.** Only checks and reviewed evidence feed `lib/core/halal.ts`
   ([spec](docs/spec/halal-model.md)).
5. **`/api` is consumed by clients we don't deploy together** (a mobile app is planned): additive changes only.
6. **Email templates and analytics goal names are append-only.** Goals are `snake_case`, never carry PII.
7. **Test hooks are non-production only**: gate them with `isNonProductionRequest` from `lib/worker-env.ts`
   (backed by `lib/environment.ts`), never a raw hostname check.

There is no feature-flag store yet (mosques.world uses KV flags). Until there is, ship large user-facing changes in
slices that are safe to release, or gate them to non-production hosts with `isNonProductionRequest`.

## Code conventions

- TypeScript strict, ESM, `@/` imports from the repo root. Unused vars must start with `_`.
- Read bindings with `readBinding()` / `readWorkerEnv()` from `@/lib/worker-env` and D1 with `database()` from
  `@/lib/db`, never a static `process.env.NAME` (it's inlined at build time). A new binding goes in
  `wrangler.jsonc` at the top level **and** in `previews` (pointed at a preview resource); never add
  `send_email`, queues, routes or crons to `previews`. `lib/wrangler-config.test.ts` enforces this.
- Validate every input at the boundary. Validation lives in pure parsers (`lib/core/check.ts`,
  `lib/core/params.ts`, `parseListFields`, …) that return `{ ok, error }` with a user-facing sentence. Dynamic
  route segments go through `lib/core/params.ts` before they reach SQL.
- SQL is Drizzle `sql\`…\`` templates or `.prepare().bind()`: never interpolate user input into SQL strings.
- Mutating route handlers follow [`app/api/lists/route.ts`](app/api/lists/route.ts):
  `requireUser(request, returnTo)` → `readJson` → parse/validate (400) → `spendBudget(<limiter>, auth)` (429) →
  work in `lib/` → `json(...)` / `unavailable()`. Error strings are user-facing sentences; never leak database
  or provider details.
- Every query over `checks` applies `visibleAuthor()` or names its audience (`tests/check-visibility-audit.test.ts`).
- Keep `lib/core` pure so it can be shared with a mobile app; push I/O to the edges so logic stays unit-testable.
- Comments explain why, not what. Match the existing JSDoc one-liners on exported functions.

## Safety

Workers Builds deploys automatically: every pushed branch gets a Worker Preview (and applies new migrations to the
shared preview D1), and every merge to `main` takes a Time Travel bookmark, applies migrations to production D1 and
deploys. So a migration on a branch reaches the shared preview database as soon as you push, and production when merged.

Never do these unless a human explicitly asked for that specific action in this task:

- `pnpm deploy`, `pnpm deploy:preview`, `pnpm cf:deploy`, `pnpm cf:preview`, `wrangler deploy`,
  `wrangler preview`, `wrangler versions upload`, `wrangler rollback`, or anything with `--remote` (D1, R2).
- `pnpm db:migrate:preview` / `db:migrate:remote`, the backfill and import scripts in `scripts/` against remote
  data, `wrangler secret put`, Cloudflare dashboard settings, or DNS.
- Never commit secrets. Local secrets live in `.dev.vars` (gitignored).

## Git and PRs

- Branch from `main`; never push to `main`. Open PRs as **drafts**.
- Commit subjects are short imperative sentences; one logical change per commit.
- Fill in [the PR template](.github/pull_request_template.md): before/after, how, rollout (migrations, secrets,
  dashboard steps) and checks, including the "Not verified:" line. Try UI changes on the PR's Preview URL.

## Agent tooling

Claude Code reads [`CLAUDE.md`](CLAUDE.md), which imports this file. Task playbooks live in
[`.claude/skills/`](.claude/skills) and path-scoped rules in [`.claude/rules/`](.claude/rules); they are
plain Markdown, so other agents can read them too:

| Playbook | Use it to |
| --- | --- |
| [`preflight`](.claude/skills/preflight/SKILL.md) | run the pre-push checks and report results |
| [`ship-feature`](.claude/skills/ship-feature/SKILL.md) | build a feature end to end (data, logic, routes, UI, tests, docs, PR) |
| [`d1-migration`](.claude/skills/d1-migration/SKILL.md) | write and apply a D1 migration safely |
| [`steward`](.claude/skills/steward/SKILL.md) | drive an open PR to green |
