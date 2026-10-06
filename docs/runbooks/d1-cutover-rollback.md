# Rolling back the Oct 5, 2026 D1 cutover

On Oct 5, 2026 production moved from D1 `halalfood-world` (3e4b080f-0559-4235-9923-2d6e4dec528f, the old schema) to D1 `halalfood-world-v2` (889b19af-2870-45b4-b6ee-92c3686010f0, `0001_baseline.sql` plus the imported places). The cutover came with the redesign (#92). The old database was not modified and is the rollback target.

| | Value |
|---|---|
| Last pre-cutover Worker version | `5a6e0488-c120-4106-9e7d-736a83bb0a4b` (#87 on top of #88; old schema; bound to `halalfood-world`) |
| Old prod D1 | `halalfood-world`, `3e4b080f-0559-4235-9923-2d6e4dec528f` |
| Old prod Time Travel bookmark (15:53 IST, Oct 5) | `000006b9-00000000-000050fb-56e1891fc58cf704b01ccb345c18297a` |
| v2 Time Travel bookmark after the import and admin seed (15:59:35 IST, Oct 5) | `00000001-00000052-000050fb-35cab1c8555e338341240aebe4ff0d00` |
| Full export of old prod | `/workspace/backups/halalfood-world-2026-10-05-precutover.sql` (23.1 MB, 7,706 places), on the shared agent box |
| Place import into v2 | `/workspace/halalfood-world/cutover/` (`import-places.sql`, `seed-admin.sql`, `verify-v2.sql`, `NOT-CARRIED.md`) |

Rolling back loses anything written to v2 after the cutover (accounts, checks, lists, and so on). Export v2 first if any of that matters:

```sh
npx wrangler d1 export halalfood-world-v2 --remote --output=halalfood-world-v2-$(date +%Y%m%d-%H%M).sql
```

## 1. Put the old Worker version back (minutes)

Version 5a6e0488 carries its own binding to `halalfood-world`, so redeploying it restores the old site and the old database together. Run from the repo root with a Workers deploy token:

```sh
npx wrangler rollback 5a6e0488-c120-4106-9e7d-736a83bb0a4b --name halalfood-world \
  --message "Roll back D1 cutover to halalfood-world"
# equivalent:
npx wrangler versions deploy 5a6e0488-c120-4106-9e7d-736a83bb0a4b@100% --name halalfood-world -y
```

Check it:

```sh
npx wrangler deployments status --name halalfood-world   # 5a6e0488 at 100%
curl -s -o /dev/null -w '%{http_code}\n' https://halalfood.world/
curl -s 'https://halalfood.world/api/places/search?q=samad&limit=1'   # old API shape, Samad Cafe
```

## 2. Stop main from redeploying the new code

Until main is reverted, the next merge redeploys the redesign against v2. Revert the cutover PR's `wrangler.jsonc` change, which points the `DB` binding back at the old database:

```jsonc
"database_name": "halalfood-world",
"database_id": "3e4b080f-0559-4235-9923-2d6e4dec528f",
```

Since the repo was flattened, `wrangler.jsonc` is the only place that names the production database (`db:migrate:remote` and `cf:deploy` go through the `DB` binding). Point it back by hand rather than with `git revert`, which no longer applies cleanly.

The redesign's code (#92) only works against the baseline schema. Workers Builds deploys `main` with `pnpm cf:deploy`, which applies pending migrations before `wrangler deploy`. On `halalfood-world` the baseline is pending, its first statement fails with `table "user" already exists`, and the deploy stops there. Do not let it get that far, and never force the baseline onto the old database: it destroys the rollback. Before merging a rollback, change the production build's deploy command to `pnpm exec wrangler deploy` (no migrations) and put it back afterwards. A full rollback of main therefore means reverting #92 as well:

```sh
git revert --no-edit <cutover merge sha>
git revert --no-edit c35beb7   # #92, the redesign
```

Open a PR and squash-merge it once CI is green.

## 3. If the old database itself needs restoring

It was not written to during the cutover. If something did write to it, restore it to the bookmark (this overwrites everything after 15:53 IST, Oct 5):

```sh
npx wrangler d1 time-travel restore halalfood-world \
  --bookmark=000006b9-00000000-000050fb-56e1891fc58cf704b01ccb345c18297a
```

Time Travel keeps 30 days of history. After that, rebuild from the export: create a new D1 database, run `npx wrangler d1 execute <new-db> --remote --file=/workspace/backups/halalfood-world-2026-10-05-precutover.sql`, and point `wrangler.jsonc` at the new database.

To take v2 back to its just-imported state (places plus the admin seed, no user data):

```sh
npx wrangler d1 time-travel restore halalfood-world-v2 \
  --bookmark=00000001-00000052-000050fb-35cab1c8555e338341240aebe4ff0d00
```

Remote D1 writes (restore, execute) are for whoever operates Cloudflare (the Cloudflare bot), not app agents.
