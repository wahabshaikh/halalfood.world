---
name: steward
description: Drive an open halalfood.world pull request to a mergeable state by reproducing CI failures locally, fixing root causes, handling review comments and merge conflicts. Use when a PR has red CI, review feedback or conflicts.
---

# Steward a PR

1. **Look at the whole PR**: merge state, CI on the latest commit, every unresolved review thread.
2. **Conflicts**: merge `main` into the branch (no rebase or force-push on someone else's branch).
   Regenerate `pnpm-lock.yaml` with `pnpm install`, never by hand. If two migrations now share a
   number, renumber **the PR's** migration, never the one on `main`.
3. **Red CI**: CI (`.github/workflows/ci.yml`) has two jobs. `check` runs `pnpm verify` (lint,
   typecheck, unit tests with the coverage ratchet) and `pnpm build`. `e2e` runs the Playwright suite against the
   production build; reproduce it with `E2E_BUILD=1 pnpm e2e <folder>` (`--project=chromium` in
   sandboxes) and read the `playwright-report` artifact's traces with `pnpm exec playwright show-trace`.
   Reproduce the failing step locally with the same command first, then fix the cause and show the same
   command passing. A coverage failure means missing tests. Treat every failure as real, not a flake.
4. **Review comments**: implement small, local asks; reply with a proposal on larger design asks.
   Resolve threads you addressed.
5. **Before each push** run the `preflight` skill. One validated push beats several speculative ones.
6. Never skip, `.only`, or weaken a test, lower coverage thresholds, or disable a lint rule to get green.
