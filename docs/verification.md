# Verifying changes

Every change should be checked the way a user would see it, signed in where the
feature needs it. There are three layers, fastest first.

| Command | What it checks | Needs |
| --- | --- | --- |
| `npm run typecheck` | Types across every workspace | nothing |
| `npm test` | Unit tests (`node:test`) in `packages/core/tests` and `apps/web/tests` | nothing |
| `npm run test:e2e` | Playwright against the production build on a seeded local D1 | Chromium |
| `npm run verify` | All three, in that order | Chromium |

CI runs the end-to-end suite on every pull request
([`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml)), next to the
typecheck and unit test checks.

## End-to-end tests

`npm run test:e2e` builds the app, applies migrations and
[`seed/places.sql`](../apps/web/seed/places.sql) to a throwaway database in
`apps/web/.wrangler/e2e`, serves it with `wrangler dev` on port 8787, and runs
[`apps/web/e2e`](../apps/web/e2e). It never touches your `npm run dev` database.

```sh
npx playwright install chromium                  # once
npm run test:e2e                                 # everything
npm run test:e2e -- e2e/sign-in.spec.ts          # one file
npm run test:e2e -- -g "saving a place"          # one test
E2E_SKIP_BUILD=1 npm run test:e2e                # reuse the last build
TEST_BASE_URL=http://localhost:3000 npm run test:e2e   # against `npm run dev`
```

Failures keep a trace, screenshot and HTML report under
`apps/web/.test-artifacts/` (`npx playwright show-report .test-artifacts/e2e-report`
from `apps/web`). Tests also fail on any uncaught error in the page.

In a sandbox that ships its own Chromium or sends traffic through a proxy, set
`PLAYWRIGHT_CHROMIUM_PATH` and `PLAYWRIGHT_PROXY` instead of installing a
browser. The map tiles and fonts are external, so the map needs network access.

## Test sign-in

On local servers and pull request previews, any address at `example.com` signs
in with code `424242`. No email is sent, and the bot check and send limits are
skipped for these addresses only. Real addresses still go through Turnstile,
the limits and Resend.

It is switched on by where the app runs, not by a setting: `BETTER_AUTH_URL`
must be `localhost`/`127.0.0.1`, or an `https://pr-<number>-…workers.dev`
preview alias. Production runs at `https://halalfood.world`, so the fixed code
is refused there even if a preview's variables were copied into production.
The rules live in [`src/lib/auth-test-mode.ts`](../apps/web/src/lib/auth-test-mode.ts)
and are unit-tested in `tests/auth-test-mode.test.ts`.

By hand: open `/login`, enter `you@example.com`, then `424242`. A new address
lands on onboarding, as a real first sign-in does.

In a test, two ways to be signed in:

```ts
import { signIn, testEmail, USER_STATE } from "./support/auth";
import { expect, test } from "./support/test";

// Reuse the user from auth.setup.ts; quickest for read-only checks.
test.describe("signed in", () => {
  test.use({ storageState: USER_STATE });
  test("…", async ({ page }) => { /* page is signed in */ });
});

// A fresh user for anything that changes data, or for two-user flows.
test("…", async ({ page, browser }) => {
  await signIn(page.request);                       // this page's context is signed in
  const friend = await browser.newPage();
  await signIn(friend.request, testEmail("friend")); // a second user
});
```

`signIn` uses the real `/api/auth/email-otp/*` endpoints, so the session cookie
is exactly what a browser gets. To drive the login form itself, call
`stubTurnstile(page)` from `./support/turnstile` first, as
[`sign-in.spec.ts`](../apps/web/e2e/sign-in.spec.ts) does.

## Writing a test for a change

- Put it in `apps/web/e2e/<area>.spec.ts` and import `test`/`expect` from
  `./support/test`.
- Find elements by role and name (`getByRole("button", { name: "Save this place" })`),
  not CSS classes; the design changes often.
- Assume only the seed data exists. Add fictional rows to `seed/places.sql`
  (it must stay idempotent) rather than depending on production data.
- Use a fresh `signIn` user for anything that writes, so tests can run in any
  order and in parallel.
- Keep secrets out of tests. Nothing in the suite needs one.

## Pull request previews

Each same-repository pull request deploys to
`https://pr-<number>-halalfood-world.wahabshaikh.workers.dev` with its own D1
database. The link is posted as a comment on the pull request. Test sign-in
works there, so you can check signed-in pages by hand with `you@example.com`
and `424242`, or run the suite against it:

```sh
TEST_BASE_URL=https://pr-123-halalfood-world.wahabshaikh.workers.dev npm run test:e2e
```

The suite assumes the seed places exist; load them into a preview database
with `wrangler d1 execute <database> --remote --file apps/web/seed/places.sql`.
