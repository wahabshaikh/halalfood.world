# Unverified imported places

About 7.7k places were scraped from halalfoodnear.me on 13 Sep 2026 and carried into production D1
(`halalfood-world-v2`) at the Oct 5 cutover, without their scrape columns (`source`, `source_url`, `scraped_at`).
They stay listed, labelled "Unverified", and out of search engines until something shows they exist. The rule is in
[the halal model](../spec/halal-model.md#provenance); the code is `lib/core/provenance.ts` (pure) and
`lib/provenance.ts` (recompute).

## How the imported rows are identified

The cutover export shows 7,706 carried places. 7,705 share the bulk insert's timestamp and all of them match the
halalfoodnear.me scrape by name and city (7,662 also by Google place id); 7,674 are `listed` and 31 `hidden`. The one
other carried row (Slam Burger Luton) has its own `created_at`. Places created since (Add a place, Scout) use their own
`Date.now()`, so none can share that millisecond:

```sql
created_at = 1789282699475 AND submitted_by_user_id IS NULL   -- 2026-09-13T06:58:19.475Z
```

Migration [`0007_place_provenance.sql`](../../migrations/0007_place_provenance.sql) sets
`import_source = 'halalfoodnear.me'` on those rows, then sets `import_verified_at` on the ones that already have
evidence. It runs automatically when this merges (`pnpm cf:deploy` takes a Time Travel bookmark first). Both UPDATEs
are idempotent; there is no BEGIN/COMMIT because D1 rejects explicit transactions.

| Column | Meaning |
| --- | --- |
| `import_source` | `'halalfoodnear.me'` for the import, NULL for everything else. Written once by 0007. |
| `import_verified_at` | When an imported place was first found verified to exist; NULL while it is unverified. Recomputed by the app on every check, evidence review, Scout claim, creator verification and merge. |

Labelled and noindexed: `import_source IS NOT NULL AND import_verified_at IS NULL`.
In the sitemap: `listing_status = 'listed' AND (import_source IS NULL OR import_verified_at IS NOT NULL)`.

## Counts (read only)

Two SELECT-only files report what the change does. Run them locally:

```sh
pnpm exec wrangler d1 execute DB --local --file=scripts/sql/unverified-counts-before.sql   # schema before 0007
pnpm exec wrangler d1 execute DB --local --file=scripts/sql/unverified-counts-after.sql    # schema after 0007
```

- [`unverified-counts-before.sql`](../../scripts/sql/unverified-counts-before.sql) works on the current schema
  (no new columns): total and listed places, what the sitemap indexes today (every listed place), how many rows the
  predicate would flag, how many of those already have evidence, and the projected indexable count after 0007.
- [`unverified-counts-after.sql`](../../scripts/sql/unverified-counts-after.sql): total, indexable, imported,
  labelled unverified, imported but verified, and a consistency check that the import source still matches the
  predicate exactly.

Against production, an operator runs the same files with `--remote` instead of `--local`, only with approval.
Expected before 0007 from the export: about 7,705 flagged (7,674 listed, 31 hidden). This change has not
inspected production.

## Rollback

Code: roll back the Worker as usual ([deployment](../deployment.md#rollback)). Old code ignores the new columns.

Data: [`scripts/rollback/0007_place_provenance_down.sql`](../../scripts/rollback/0007_place_provenance_down.sql)
clears `import_source` and `import_verified_at` for the import, so nothing is labelled, noindexed or left out of the
sitemap. It drops nothing: deployed code reads both columns. It lives outside `migrations/` because wrangler applies
every `migrations/*.sql`. Operator only, with approval:

```sh
pnpm exec wrangler d1 time-travel info DB                      # note the bookmark
pnpm exec wrangler d1 execute DB --remote --file=scripts/sql/unverified-counts-after.sql
pnpm exec wrangler d1 execute DB --remote --file=scripts/rollback/0007_place_provenance_down.sql
pnpm exec wrangler d1 execute DB --remote --file=scripts/sql/unverified-counts-after.sql   # imported = 0
```

To relabel afterwards, run 0007's two UPDATE statements again (from a file, never `--command`: a leading `--`
comment is parsed as a flag). For wider data damage, restore the deploy's bookmark:
`pnpm exec wrangler d1 time-travel restore DB --bookmark=<bookmark>`.

## After a place is verified

Its label and `noindex` go on its next page load (place pages are not edge-cached). The flip publishes a listing
change, which moves cached listing reads on and purges the `sitemaps` cache tag, so it rejoins the sitemap at once;
if the purge fails it rejoins within the existing lifetimes (6 hours for the sitemap read and documents, plus
`stale-while-revalidate`).
