---
name: preflight
description: Run halalfood.world's pre-push checks (pnpm verify, build, and the E2E the change touches) and report exactly what passed, failed or was not run. Use before pushing, before opening or marking a PR ready, and whenever asked to verify a change.
---

# Preflight

Run the same checks CI runs, plus the E2E that covers the change, and report results honestly.

## 1. Static checks and unit tests

This is CI's `check` job. Fix the first failure before moving on:

```sh
pnpm verify   # lint, typecheck, unit tests with the coverage ratchet
pnpm build
```

- A coverage failure means new `lib/` code lacks tests: add them, don't lower thresholds.
- `pnpm build` catches vinext/RSC boundary errors that typecheck misses (server-only imports in client
  components, unsupported Next APIs).
- `lib/wrangler-config.test.ts` failing means `wrangler.jsonc`'s `previews` block now shares something with
  production. Fix the config, never the test.

## 2. Pick the E2E that covers the change

Map changed files (`git diff --name-only origin/main...`) to suites:

| Changed | Run |
| --- | --- |
| Only `lib/` logic with unit tests, docs, config comments | none required; say so |
| A page, component or route handler | `pnpm e2e e2e/smoke` |
| `lib/auth*.ts`, `app/api/auth`, `app/login`, `lib/email.ts`, `lib/worker-env.ts`, `lib/environment.ts` | `pnpm e2e e2e/auth` |
| `proxy.ts`, `app/layout.tsx`, `worker/index.ts`, `vite.config.ts` | `pnpm e2e` (everything) |
| Client data fetching or retry logic | also `LOOP_AUDIT=1 pnpm e2e e2e/smoke/fetch-loops.spec.ts --project=chromium` |
| A migration | `pnpm db:migrate:local`, then the suite that reads the new tables |

`pnpm e2e` starts the dev server (with local migrations and the seed) itself. In sandboxes add
`--project=chromium` (the SessionStart hook sets `PLAYWRIGHT_CHROMIUM_EXECUTABLE`). Use `E2E_BUILD=1` to test
the production build, as CI's `e2e` job does. Signed-in tests use `POST /api/test/session`; no real email
is needed. For UI changes also run `pnpm shot <path> [--as <email>] [--mobile]` and look at the screenshots in
`.artifacts/screenshots/`. Google Places search needs a key in `.dev.vars`; if a test can't run for that reason,
record it rather than skipping it silently.

## 3. Report

Reply (or put in the PR body under "Checks") one line per check, for example:

```
- pnpm verify ✅ (lines 68%)  pnpm build ✅
- pnpm e2e --project=chromium ✅ (23 passed)
- Not run: Google search on /add (needs GOOGLE_PLACES_API_KEY)
```

Never write ✅ for something you did not run in this session.
