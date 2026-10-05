# @halalfood/web

The vinext app that ships as the `halalfood-world` Cloudflare Worker. Read the
root `AGENTS.md` first. The README's sections on auth, rate limits, bounded
APIs, migrations and deployment are the long-form reference for this package.

## Where things go

| You are adding | Put it in | Follow |
| --- | --- | --- |
| A JSON endpoint | `app/api/<path>/route.ts` | `app/api/visits/[id]/like/route.ts`, skill `add-api-route` |
| A page | `app/<path>/page.tsx` (+ `*-view.tsx` for client parts) | `app/place/[id]/page.tsx`, skill `add-page` |
| SQL | `src/lib/<area>-repository.ts` | `src/lib/social-repository.ts` |
| A table or column | `migrations/NNNN_*.sql` + `src/db/schema.ts` | skill `add-d1-migration` |
| A rate limit | `src/lib/otp-rate-limit.ts` (`*_RATE_LIMITS` + `consume*Limits`) | existing entries |
| A pure rule | `packages/core/src/<concept>.ts` | `packages/core/AGENTS.md` |
| A shared UI block | `src/components/<name>.tsx` | `site-chrome.tsx`, `section.tsx` |

## Runtime gotchas

- Code runs in workerd with `nodejs_compat`. Bindings and secrets are read at
  request time: D1 through `database()` (`src/db/index.ts`), R2 through
  `src/lib/r2.ts`, secrets through `process.env.*`. Never read them at module
  top level, and never cache a Better Auth instance across requests
  (`createAuth()` is per request).
- `cloudflare:workers` is imported dynamically so the same modules load under
  plain Node in tests; keep that pattern for any new binding.
- Route params are promises (`await context.params`).
- Server components are the default. Add `"use client"` only to the component
  that needs state or browser APIs, and keep data fetching on the server.
- `proxy.ts` is the middleware; its matcher skips `/api`.
- The build output is staged at the repo root by
  `scripts/stage-cloudflare-build.mjs` because Workers Builds and the preview
  workflow run from the root. Do not commit the root `dist/`, `migrations/` or
  `wrangler.jsonc` copies (they are gitignored).

## Tests

- `tests/*.test.ts` run with `npx tsx --test tests/<file>`.
- Route tests import the exported handler and call it with a `Request` and
  `{ params: Promise.resolve({...}) }`. Older routes also export
  `handle*` functions that take injected dependencies (`getAuth`,
  `consumeLimits`, `repository`); use them to test signed-in paths without a
  real session.
- Repository tests use `createTestDatabase()` and `addUser()` from
  `tests/support/sqlite-d1.ts`, which applies every migration to an in-memory
  `node:sqlite` database, and pass its `db` as the repository's `client`.
- End-to-end specs live in `e2e/*.spec.ts` (Playwright, run by
  `npm run test:e2e`). Import `test`/`expect` from `e2e/support/test`, find
  elements by role, depend only on `seed/places.sql`, and use a fresh
  `signIn()` user for anything that writes. See `docs/verification.md`.
