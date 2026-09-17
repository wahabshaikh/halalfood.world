# Evidence-first halal status implementation plan

> **Goal:** Replace the place page’s unconditional halal claim with an evidence-derived public status and expose the same summary through the verification API.
>
> **Architecture:** Add a small status domain/repository module that aggregates approved verification rows. Reuse it in the verification API and an async server-rendered hero badge, while the existing client verification section consumes the API summary. Preserve current visibility rules and keep `halal_confirmed` as a listing flag.
>
> **Tech Stack:** TypeScript, React 19, vinext/Next-compatible server components and route handlers, Drizzle raw SQL over Cloudflare D1, Node test runner with `tsx`, CSS.
>
> **Spec:** `docs/product/evidence-first-halal-status.md`

## Global constraints

- Follow strict TDD: add a failing test, run it and capture the expected failure, implement the minimum code, then rerun green before refactoring.
- Run tests with Node 22 using `node --import tsx --test ...`; the sandbox blocks the `tsx` CLI IPC socket.
- Do not edit existing migrations or add a new migration.
- Do not change map ranking, ratings, reviews, or the `halal_confirmed` publication semantics.
- Never use “certified” or “verified halal” for the derived state. Use `Evidence-backed`, `Unverified`, and `Evidence status unavailable` exactly.
- Each task ends with a focused test run, `npm run typecheck`, self-review, a commit, and an implementation report in the task path supplied by the orchestrator.

### Task 1: Add the halal evidence status domain and D1 repository

**Files:**

- Create: `src/lib/halal-status.ts`
- Create: `tests/halal-status.test.ts`

**Steps:**

1. Add failing unit tests for a pure summary mapper covering zero approved rows, positive approved counts, valid numeric/string/Date timestamps, and malformed timestamps. The public output must be a discriminated union with keys `unverified`, `evidence-backed`, and `unavailable`; only the first two come from successful repository data.
2. Add a failing repository-boundary test using an injectable `HalalStatusRepository` to prove the service requests one place and returns the normalized summary without a real database.
3. Run `node --import tsx --test tests/halal-status.test.ts` and confirm failure because the module/API does not exist.
4. Implement the minimum domain types, defensive timestamp normalization, pure mapper, repository interface, D1 repository, and `getHalalStatus` service. The SQL must count only approved rows for a published place and select `MAX(updated_at)`.
5. Rerun the focused test, then run the full unit suite with `node --import tsx --test tests/*.test.ts` and `npm run typecheck` under Node 22.
6. Commit as `feat: derive halal status from approved evidence`.

### Task 2: Expose the status summary in the verification API

**Files:**

- Modify: `app/api/places/[id]/verifications/route.ts`
- Modify: `tests/halal-verification.test.ts`

**Steps:**

1. Add failing GET-handler tests for: malformed IDs; missing places; a public response containing both the existing `verifications` array and the normalized `summary`; and an unavailable status/repository response returning the existing 503 shape.
2. Export an injectable `handleVerificationGet` in the same style as `handleVerificationPost`. Keep authentication optional for reads and preserve public versus own-pending visibility.
3. Fetch the verification list and status summary without deriving the count from the visible list. Return `{ verifications, summary }`, keeping current cache behavior (`no-store` for authenticated responses and a short public cache otherwise).
4. Rerun `node --import tsx --test tests/halal-verification.test.ts`, the full unit suite, and `npm run typecheck` under Node 22.
5. Commit as `feat: expose halal evidence summary`.

### Task 3: Render truthful status on the place page

**Files:**

- Create: `app/place/[id]/place-halal-status.tsx`
- Modify: `app/place/[id]/page.tsx`
- Modify: `app/place/[id]/place-halal-verification.tsx`
- Modify: `app/globals.css`
- Modify: `README.md`
- Create: `tests/halal-status-copy.test.ts`

**Steps:**

1. Add failing copy/format tests for the three render states. Test a pure exported view-model formatter so server and client wording stays consistent: evidence count grammar, latest-reviewed date presence, the non-certification caveat, and the “does not mean non-halal” clarification.
2. Implement the formatter in `src/lib/halal-status.ts` and an async server component that loads the status for the hero. Catch lookup failures and render the explicit unavailable state.
3. Replace the static hero badge and the misleading user-submission confirmation sentence. Render the derived status label and a compact evidence detail.
4. Extend the client verification response parser to read `summary`, then render the same label/explanation above the evidence list. A pending submission must remain visibly pending and must not change the public summary.
5. Add status-specific accessible styling using existing badge/color tokens. Do not make the unverified state look like a failure or a non-halal determination.
6. Update README API and moderation documentation to distinguish listing inclusion, approved community evidence, and formal certification.
7. Run focused tests, the full unit suite, `npm run typecheck`, and `npm run build` under Node 22.
8. Commit as `feat: show evidence-first halal status`.

## Final verification

From the feature worktree with Node 22 first on `PATH`:

```sh
npm run db:migrate:local
node --import tsx --test tests/*.test.ts
npm run typecheck
npm run build
```

Then run a fresh whole-branch review against the merge base. Resolve all blocking findings, rerun the complete verification commands, push the branch, create one pull request for this feature, wait for required checks, and merge it into `main`.
