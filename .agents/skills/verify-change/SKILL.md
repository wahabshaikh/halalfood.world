---
name: verify-change
description: Decide which checks prove a change works (typecheck, unit tests, build, local dev, PR preview) and how to sign in to test signed-in flows. Use before saying any change is done.
---

# Verify a change

"Done" means you have evidence the change works, not that it compiles. Pick
the cheapest check that proves the behaviour, then widen to what the change
could break. Report what you ran and what you saw.

## Always

```sh
npm run check        # typecheck + unit tests in every package
```

Iterate on one file with `npx tsx --test tests/<file>.test.ts` inside the
package, then run `npm run check` once before pushing.

## By kind of change

| Changed | Also run |
| --- | --- |
| `packages/core` rule | Its test in `packages/core/tests/`; web tests that use it |
| Repository SQL or a migration | A repository test with `createTestDatabase()`; `npm run db:migrate:local` |
| API route | A route test calling the handler; `curl` against `npm run dev` for the happy path |
| Page, layout, client component, `proxy.ts` | `npm run build`, then load it in `npm run dev` |
| `wrangler.jsonc`, `vite.config.ts`, build scripts, dependencies | `npm run build` and `npm start` (runs the built Worker in `wrangler dev`) |
| Auth, rate limits, cookies | Tests in `apps/web/tests/auth.test.ts`, then a real sign-in (below) |
| Anything user-visible | The PR preview (below), signed out and signed in |

`npm run test:api` and `npm run test:browser` are smoke tests against a
running server with data (`TEST_BASE_URL`, default `http://localhost:3000`).
They expect a populated `places` table, so they fail on an empty local
database.

## Local setup for manual checks

1. `npm ci`
2. `npm run db:migrate:local` (creates the local D1 file under `apps/web/.wrangler/state`)
3. `apps/web/.dev.vars` (gitignored) with at least:

   ```dotenv
   BETTER_AUTH_SECRET=<32+ random characters>
   BETTER_AUTH_URL=http://localhost:3000
   # Cloudflare's always-pass Turnstile test keys
   TURNSTILE_SITE_KEY=1x00000000000000000000AA
   TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
   RESEND_API_KEY=<a Resend key, needed to receive the OTP>
   EMAIL_FROM=onboarding@resend.dev
   ```

4. `npm run dev` and use the printed URL.

## Signing in

Sign-in is Better Auth email OTP behind Turnstile (`/login`). OTPs are stored
hashed, so a code cannot be read back from the database: today you need a
Resend key and an inbox you can read. With the test Turnstile keys above the
challenge always passes. Limits: 5 codes per email per day with a 60 second
cooldown, so reuse one session rather than signing in repeatedly.

Moderator and admin screens (`/admin`) need a row in the `moderators` table
for your user id:

```sh
cd apps/web && npx wrangler d1 execute halalfood-world --local \
  --command "INSERT INTO moderators (user_id, role, created_at) VALUES ('<user id>', 'admin', 0)"
```

Keep this section current: when the repo gains a faster test sign-in path,
document it here and in the root `AGENTS.md`.

## PR previews

Every PR from this repository gets a preview Worker at
`https://pr-<number>-halalfood-world.wahabshaikh.workers.dev`, commented on the
PR by `.github/workflows/preview.yml`. It uses its own D1 database
(`halalfood-world-pr-<number>`) with all migrations applied and no data, and
production's secrets. Use it to check build, bindings, migrations and signed-in
flows in the real runtime. Signing in there sends real email.
