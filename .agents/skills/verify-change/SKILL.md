---
name: verify-change
description: Decide which checks prove a change works (unit tests, Playwright, build, PR preview) and how to test signed-in flows. Use before saying any change is done.
---

# Verify a change

"Done" means you have evidence the change works the way a user sees it, not
that it compiles. Report what you ran and what you saw. The full reference is
`docs/verification.md`; this is the short path.

## The ladder

| Command | Checks | Speed |
| --- | --- | --- |
| `npx tsx --test tests/<file>.test.ts` (in a package) | One unit test file | seconds |
| `npm run check` | Typecheck and every unit test | ~20 s |
| `npm run test:e2e -- e2e/<file>.spec.ts` | One Playwright file against the built app | a minute or two |
| `npm run verify` | Typecheck, unit tests, whole Playwright suite | a few minutes |

Iterate with the narrow commands; run `npm run verify` once before you push.
`E2E_SKIP_BUILD=1 npm run test:e2e` reuses the last build when only tests
changed. Playwright needs Chromium once: `npx playwright install chromium`
(or set `PLAYWRIGHT_CHROMIUM_PATH` where a browser is preinstalled).

## By kind of change

| Changed | Add or run |
| --- | --- |
| `packages/core` rule | A test in `packages/core/tests/` |
| Repository SQL or a migration | A repository test with `createTestDatabase()` |
| API route | A route test calling the handler; an `e2e/api.spec.ts` case for the public contract |
| Page, layout, client component, `proxy.ts` | A Playwright spec that visits it, desktop and mobile |
| Signed-in feature | A Playwright spec using `signIn()` (fresh user when it writes) |
| `wrangler.jsonc`, `vite.config.ts`, build scripts, dependencies | `npm run verify` (it builds and serves the real Worker) |

Specs find elements by role and name, never CSS classes, and depend only on
`apps/web/seed/places.sql`. Add fictional rows there (keep it idempotent) when
a test needs data.

## Signing in

On local servers and PR previews, any `@example.com` address signs in with
code `424242`: no email, no Turnstile, no send limits. Real addresses and
production are unchanged. In tests use `signIn(page.request)` or the shared
`USER_STATE` from `e2e/support/auth.ts`. By hand, open `/login`, enter
`you@example.com`, then `424242`; a new address lands on onboarding.

Moderator and admin screens (`/admin`) also need a `moderators` row for the
user:

```sh
cd apps/web && npx wrangler d1 execute halalfood-world --local \
  --command "INSERT INTO moderators (user_id, role, created_at) VALUES ('<user id>', 'admin', 0)"
```

## PR previews

Every PR gets `https://pr-<number>-halalfood-world.wahabshaikh.workers.dev`,
commented on the PR, with its own D1 database (migrations plus seed). CI runs
the suite on every PR and again against the preview. Check the change there
by hand too, signed in with an `@example.com` address.
