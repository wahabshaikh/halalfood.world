---
paths:
  - "app/api/**"
  - "lib/api.ts"
---

# Route handlers (`app/api/**/route.ts`)

- Changes are additive: never remove or rename a field, status code or route another client may use (a mobile
  app is planned). A breaking change means a new route. Update the API table in `docs/architecture.md`.
- Order inside a mutating handler (see `app/api/lists/route.ts`):
  1. Auth: `requireUser(request, returnTo)` (or `requireModerator`); return `outcome.response` when not ok.
  2. Input: `readJson(request)` (`INVALID_JSON` → `badRequest`), then a pure parser from `lib/core/` or
     `lib/<area>.ts` that returns `{ ok, error }`. Route params go through `lib/core/params.ts`.
  3. Abuse: `spendBudget(<consume…Limits>, outcome.auth)` from `lib/otp-rate-limit.ts` (per user and per IP).
  4. Work: a `lib/` function using `database()` and Drizzle `sql` templates. Never string-build SQL from input.
  5. Reply: `json(...)` or `badRequest` / `forbidden` / `unavailable` from `lib/api.ts`. Messages are short,
     friendly sentences; never include database or provider errors.
- Reads that show checks apply the visibility rule (`visibleAuthor()`); `tests/check-visibility-audit.test.ts`
  enforces it.
- Every new mutation needs unit tests for auth, validation and limits.
- `/api/test/*` routes exist only for tests and must 404 in production: gate them with
  `isNonProductionRequest(hostFromRequest(request))`, never a raw hostname check.
