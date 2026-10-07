## What changes for people using halalfood.world

Before:

After:

## How

## Rollout

<!-- Migrations, secrets to set, dashboard steps. "None" if nothing. -->

## Checks

- [ ] `pnpm verify && pnpm build` pass, plus the E2E the change touches
- [ ] Migrations (if any) are additive: no `DROP`/`RENAME` of anything deployed code still reads
- [ ] Social features don't feed halal status
- [ ] Everything in this PR is ready to be live when merged (there are no feature flags)
- [ ] Tried on the PR's Preview URL

Not verified:
