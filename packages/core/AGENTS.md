# @halalfood/core

Platform-agnostic domain rules shared by the web app and a future mobile app.
Read the root `AGENTS.md` first.

## Rules

- No I/O. Nothing here may import from `apps/*`, touch the DOM, `fetch`, D1,
  R2, `cloudflare:workers` or `process.env`. Take data in as arguments. When a
  rule depends on time, accept `now: number = Date.now()` as the last
  parameter (see `moderation.ts`) so tests can pin it.
- One module per concept (`src/<concept>.ts`), imported as
  `@halalfood/core/<concept>`. The package `exports` map is `./*` to
  `./src/*.ts`, so a new file is importable without config changes.
- Put a rule here when it is a decision about the product (who can see what,
  what counts as verified, how a status is worded) rather than about storage.
  The web app's repositories and routes call these functions; they should not
  re-implement them.
- Halal status wording lives in `halal-status-view.ts`, `halal-glance-view.ts`
  and `halal-taxonomy.ts`. Changing copy there changes it everywhere; keep
  "Unverified" from ever reading as "not halal".
- Every exported function gets a test in `tests/<concept>.test.ts`
  (`node:test` + `node:assert/strict`, run with `npx tsx --test tests/<file>`).
  Test names read as sentences about behaviour.
