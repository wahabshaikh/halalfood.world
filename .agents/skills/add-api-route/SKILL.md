---
name: add-api-route
description: Add or change a JSON API route in apps/web/app/api with session, validation, rate limit, caching headers and tests. Use for any new endpoint or mutation.
---

# Add an API route

Routes live at `apps/web/app/api/<path>/route.ts` and export `GET`, `POST`,
`PUT`, `DELETE` functions. Model new work on
`apps/web/app/api/visits/[id]/like/route.ts`.

## Steps

1. **Decide the layers.** Pure rules (who may do what, input limits, copy) go
   in `packages/core/src/<concept>.ts`; SQL goes in
   `apps/web/src/lib/<area>-repository.ts` with a `client = database()`
   parameter; the route only parses, authorises, spends budget and maps
   results to status codes.
2. **Validate the path first.** Use `uuidParam`, `placeIdParam`,
   `citySlugParam` or `pageParam` from `@halalfood/core/params`. Bad input is a
   `badRequest(...)` before any auth or SQL.
3. **Resolve the session** with `requireUser(request, returnTo)` for writes,
   or `optionalUser(request)` for reads that personalise. Return
   `outcome.response` when `!outcome.ok`.
4. **Parse the body** with `readJson(request)`; compare against
   `INVALID_JSON`, then validate with a function that returns
   `{ ok: true, data } | { ok: false, error }`. Validate before spending budget.
5. **Spend a rate-limit budget** for any write a user can repeat:
   `const limited = await spendBudget(consumeXLimits, outcome.auth); if (limited) return limited;`
   Reuse an existing `consume*Limits` in `src/lib/otp-rate-limit.ts` when the
   action fits (`consumePersonalWriteLimits` for small personal toggles), or
   add a `*_RATE_LIMITS` entry and `consume*Limits` beside the others.
6. **Do the work inside `try { ... } catch { return unavailable(); }`.** Never
   return error messages from D1 or providers.
7. **Respond with helpers from `src/lib/api.ts`** (`json`, `badRequest`,
   `notFound`, `forbidden`, `unauthorized`, `rateLimited`, `unavailable`).
   `json` sets `no-store`. Only public, visitor-independent GETs may send a
   short `public, max-age=...` instead.
8. **Visibility.** Anything that can be hidden (private account, block,
   unapproved evidence) returns `notFound`, not `forbidden`, so its existence
   does not leak. Respect the reader's dietary standard where the feed does.
9. **Notifications and side effects** use the existing helpers
   (`tryNotify` with a `dedupeKeys.*` key) and must never fail the request.

## Tests

Add `apps/web/tests/<area>-routes.test.ts` (or extend the existing one):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PUT } from "../app/api/visits/[id]/like/route";

test("liking needs a well-formed visit id before anything else", async () => {
  const response = await PUT(new Request("https://halalfood.world/api/visits/x/like", { method: "PUT" }), {
    params: Promise.resolve({ id: "not-a-uuid" }),
  });
  assert.equal(response.status, 400);
});
```

Cover at least: malformed input is rejected before I/O, signed-out writes get
401 with a `loginUrl`, and the repository behaviour with
`createTestDatabase()` (see `tests/social-repository.test.ts`). Run
`npx tsx --test tests/<file>` from `apps/web`, then `npm run check` from the root.

## Finish

- Add the endpoint to the README's "Data and bounded APIs" list when it is
  public or has limits worth knowing.
- If a page calls it from a client component, handle 401 by sending the user
  to `loginUrl`, and 429 by showing the error text.
