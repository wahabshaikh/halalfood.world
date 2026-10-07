---
paths:
  - "**/*.test.ts"
  - "e2e/**"
  - "vitest.config.ts"
  - "playwright.config.ts"
---

# Tests

- Unit tests: Vitest, `lib/**/*.test.ts` beside the module; repo-wide audits in `tests/`. Assertions use
  `node:assert/strict` with `test()` from `vitest`, matching the existing files.
  `cloudflare:workers` resolves to `lib/testing/cloudflare-workers.ts`: assign bindings onto its `env`
  in the test. `lib/testing/sqlite-d1.ts` runs the real migrations on `node:sqlite`.
- Coverage is a ratchet in `vitest.config.ts` (higher for `lib/core`). Never lower it; raise it when you can.
  Test behaviour through exported functions, not internals.
- Halal status rules (`lib/core/halal.ts`) need cases for each fact settling, flipping, ties and young accounts.
- E2E: Playwright in `e2e/` (`auth/`, `smoke/`), shared helpers in `e2e/support/`. Runs serially against one
  database (local Miniflare with `seed/local.sql`, or a Preview).
  - Sign in with `newUser()` / `signIn()` from `e2e/support/helpers.ts`, which call `POST /api/test/session`.
    Only tests of the sign-in UI itself go through the email code, read from the sink at
    `/api/test/emails?to=`. Both endpoints 404 in production. Full guide: `docs/testing.md`.
  - Use `identity()` so re-runs don't collide, and find places via `/api/places` instead of hard-coding ids.
  - Mark checks that are safe against production with `@smoke`.
- Never skip, `.only`, or loosen a failing test to get green; fix the cause or say why in the PR.
