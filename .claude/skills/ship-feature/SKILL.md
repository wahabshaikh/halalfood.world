---
name: ship-feature
description: Build a halalfood.world feature end to end, from spec to draft PR, in the order that keeps production safe (spec, data, pure rules with tests, routes, UI, E2E, docs). Use when implementing a new feature or any change that adds a screen, route or table.
---

# Ship a feature

Work in this order. Each step lists where the pattern already exists; copy it rather than inventing one.

1. **Read the spec.** `docs/spec/simplified-community-spec.md` (screens, data, API, build order) and
   `docs/spec/halal-model.md` (how status is computed). If the ask conflicts with the spec, follow the ask and
   update the spec in the same PR. Never let a social feature feed halal status.
2. **Slice it.** There are no feature flags: what merges to `main` is live. Plan slices that are each complete
   and safe to release; keep unfinished work on the branch (its Worker Preview shows it).
3. **Data.** If it needs storage, use the `d1-migration` skill (additive SQL + `lib/db/schema.ts`).
4. **Rules in `lib/core/`** when they're pure (validation, scoring, status), I/O in `lib/<area>.ts`. Tests beside
   them cover the happy path, edge cases, visibility (who can see it) and limits.
5. **Routes.** `app/api/<area>/route.ts` following `app/api/lists/route.ts` (`requireUser` → `readJson` →
   parse → `spendBudget` → `lib/` → `json`). Every write spends a per-user and per-IP budget from
   `lib/otp-rate-limit.ts`. Update `docs/architecture.md`'s route and API tables.
6. **UI.** Server component page in `app/`; client components in `components/hf/` or beside the page; compose
   shadcn/ui components from `components/ui` with theme tokens, no new stylesheet. Phone first; check desktop.
7. **E2E.** Add scenarios under `e2e/` with the helpers in `e2e/support/helpers.ts` (`newUser()` / `signIn()`
   via `POST /api/test/session`; `@smoke` for checks that are safe against production). Check the screens with
   `pnpm shot <path> --as <email> [--mobile]`. See `docs/testing.md`.
8. **Docs.** Update `docs/architecture.md` and the spec if behaviour changed. If data collection changed, say so
   in the PR and cover it in account deletion (`deleteAccount` in `lib/profiles.ts`).
9. **Verify.** Run the `preflight` skill.
10. **PR.** Push the branch (Workers Builds then gives it a Preview URL on the shared preview database) and open a
    **draft** PR using `.github/pull_request_template.md`: fill in Rollout and "Not verified:". Try UI changes on
    the Preview URL once the build bot posts it.

Do not deploy, run remote/preview migrations or backfills yourself, or set secrets; list those as Rollout steps in
the PR for a human. Merging to `main` deploys and migrates production.
