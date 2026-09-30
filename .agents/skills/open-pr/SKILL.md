---
name: open-pr
description: Branch, commit, push and open a pull request for halalfood.world, then check CI and the preview deployment. Use when a change is ready to share.
---

# Open a pull request

## Before pushing

1. Work on a branch, never `main`.
2. `npm run check` passes. If you touched pages, config or dependencies,
   `npm run build` passes too (skill `verify-change`).
3. Re-read the diff: no secrets, no `.dev.vars`, no staged root `dist/`,
   `migrations/` or `wrangler.jsonc` copies, no debugging output, docs updated
   (README section, nearest `AGENTS.md`) where behaviour changed.

## Commit

- Subject: one imperative sentence about what changes for users or
  developers, under about 72 characters (for example "Cut D1 reads and writes
  on every page view"). No `feat:` prefixes.
- Body: why, and anything a reviewer could not guess from the diff.
- Several focused commits are fine; they are squashed on merge.

## Pull request

- Open it as a draft. Fill `.github/pull_request_template.md`: what a user
  sees before and after, how it works, how you verified it, and whether it has
  a migration.
- Title in the same style as the commit subject.
- Keep it to one concern. Split unrelated fixes into their own PRs.

## After opening

- CI (`Pull request preview`) typechecks, tests, builds, then deploys the
  preview and comments its URL. A red build is yours to fix before anything
  else.
- Check the change on the preview URL, signed out and signed in if it
  touches signed-in flows, and note what you checked in the PR.
- Do not merge, deploy to production, or run remote migrations unless the user
  asks.
