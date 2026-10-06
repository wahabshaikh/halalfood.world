# Testing and verifying changes

Everything here runs offline against a local Worker (Miniflare D1 and R2) with the sample places in
[`seed/local.sql`](../seed/local.sql). No Cloudflare account, secrets or real email are needed.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm verify` | Lint, typecheck, unit tests with coverage thresholds. Run before every push. |
| `pnpm build` | The production build; catches RSC boundary errors typecheck misses. |
| `pnpm e2e` | The Playwright suite. Starts `pnpm dev` (after local migrations and the seed) unless one is already on :5173. |
| `pnpm e2e e2e/auth` | One folder. Add `-g "title"` for one test, `--project=chromium` to skip the phone project. |
| `E2E_BUILD=1 pnpm e2e` | Same, against the production build running in workerd (`vite preview`), as CI does. |
| `pnpm e2e:smoke` | Only tests tagged `@smoke` (safe against any deployment). |
| `LOOP_AUDIT=1 pnpm e2e e2e/smoke/fetch-loops.spec.ts --project=chromium` | The request-loop audit: forces every API call to fail and checks no page retries in a loop. Slow, so off by default. |
| `pnpm auth:session --email a@example.com [--moderator] [--not-onboarded]` | Signs a person in on a running server and writes a Playwright storage state to `.auth/`, plus a cookie for `curl`. |
| `pnpm shot /saved /me --as a@example.com [--mobile] [--dark]` | Signed-in (or signed-out, without `--as`) full-page screenshots to `.artifacts/screenshots/`; prints status codes and browser errors. |

CI (`.github/workflows/ci.yml`) runs `check` (lint, typecheck, unit tests with coverage, build) and `e2e` (the
Playwright suite against the production build) on every pull request. A failed `e2e` job uploads the HTML report
and traces as the `playwright-report` artifact (`pnpm exec playwright show-trace <trace.zip>`).

## Unit tests

Vitest, `*.test.ts` beside the module in `lib/` (`lib/foo.ts` → `lib/foo.test.ts`), plus repo-wide audits in
`tests/` (for example `tests/check-visibility-audit.test.ts` fails if a query over `checks` doesn't say which
audience it serves).

- `cloudflare:workers` resolves to `lib/testing/cloudflare-workers.ts`: assign bindings onto its `env` in the test.
- `lib/testing/sqlite-d1.ts` runs the real migrations on `node:sqlite` and returns a Drizzle client (`db`) and
  the raw D1-shaped `binding`.
- Coverage is a ratchet in `vitest.config.ts`: 65% lines overall today and 90% for the pure rules in `lib/core`.
  New code comes with tests; raise the numbers as coverage grows, never lower them.

## Signing in during tests

Two test-only endpoints answer on `localhost`, `127.0.0.1` and Worker Preview hosts, and return 404 in production:

- `POST /api/test/session` `{ email, name?, onboarded?, moderator?, ageDays? }` creates the account if needed,
  applies the fields, opens a real Better Auth session and sets its cookie. Accounts default to 2 days old, since
  checks only count from accounts at least a day old. Use it for everything that isn't the sign-in UI itself.
- `GET /api/test/emails?to=<email>` returns the newest mail sent to that address from the `email_sink` table.
  The sign-in test reads the 6-digit code from it.

In specs, use the helpers in `e2e/support/helpers.ts`:

```ts
import { newUser, signIn } from "../support/helpers";

// A fresh signed-in person in their own context (page, page.request and context.request are signed in).
const { page, person } = await newUser(browser, "amina", { moderator: true });

// Or sign the default context in.
test("…", async ({ context, page }) => {
  await signIn(context, "mod@example.com", { moderator: true });
});
```

The sign-in UI test stubs Turnstile's script in the browser (`stubTurnstile`), so it passes in sandboxes that
can't reach `challenges.cloudflare.com`; the server still verifies the token with Cloudflare's test secret.

## Writing E2E tests that stay green on re-runs

The local database persists between runs (`.wrangler/state`), and suites share it.

- Use `identity(prefix)` for unique emails and client IPs. Sign-in limits are counted per `cf-connecting-ip`, so a
  fixed IP gets blocked after a few re-runs.
- Read emails with `?to=<address>`, never the global latest message.
- Find places through `/api/places` rather than hard-coding ids, so smoke tests also run against a Preview.
- Typing into a controlled input before hydration is lost; retry with `expect(...).toPass()` as the sign-in test does.

To start clean: `rm -rf .wrangler/state && pnpm db:migrate:local && pnpm db:seed:local`.

## Sandboxes without Playwright's browser download

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a system Chromium (for example `/opt/pw-browsers/chromium` in Claude Code
cloud sessions) and run with `--project=chromium`.

## Against a preview deployment

`PLAYWRIGHT_BASE_URL=https://<branch>-halalfood-world.<subdomain>.workers.dev pnpm e2e` skips the local server. A
Preview is non-production, so the same test endpoints work there.
