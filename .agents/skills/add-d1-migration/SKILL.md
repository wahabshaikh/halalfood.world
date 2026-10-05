---
name: add-d1-migration
description: Add a table, column or index to the Cloudflare D1 database safely, keeping migrations, the Drizzle schema and tests in sync. Use for any schema change.
---

# Add a D1 migration

D1 is SQLite. Migrations are applied in order by
`wrangler d1 migrations apply` (local and PR previews, which start empty) and
by `apps/web/scripts/apply-d1-migrations.ts` in production.

## Steps

1. **Name it.** Next number after the highest file in `apps/web/migrations/`:
   `NNNN_short_snake_name.sql`. Never edit or renumber a migration that is on
   `main`; it has already run in production.
2. **Write additive SQL.** Match the header style of the latest migration:
   - start with comments saying what the change is for and whether it can
     affect halal status (it almost never should);
   - `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`;
   - ids are `text`, timestamps are Unix epoch milliseconds `integer`,
     booleans are `0`/`1` integers, JSON is `text`;
   - foreign keys to `"user"("id")` and `places` use `ON DELETE CASCADE` unless
     the row must outlive them;
   - enumerations are `CHECK (... IN (...))` constraints.
3. **Respect the production runner.** It refuses `DROP TABLE`, any rebuild or
   column drop of `places`, and splits on `;` with a quote-aware scanner that
   does not skip comments. So: no quote characters (`'`, `"`, backtick) inside
   `--` comments, and no semicolons inside comments. SQLite cannot add a
   constraint to an existing column; add a new table or column instead.
4. **Mirror it in `apps/web/src/db/schema.ts`** with the same table, column
   and index names. Better Auth tables are managed by Better Auth: change them
   only through a new migration after reviewing the Better Auth schema.
5. **Index for the reads you add.** D1 bills rows scanned. Every new list or
   lookup query should hit an index; check with
   `EXPLAIN QUERY PLAN` against the test database if unsure.
6. **Test against the real SQL.** `createTestDatabase()` in
   `apps/web/tests/support/sqlite-d1.ts` applies every migration to
   `node:sqlite`, so a repository test exercises the new schema. Add one.
7. **Apply locally**: `npm run db:migrate:local`, then use the feature in
   `npm run dev`.

## Do not

- Run `npm run db:migrate:remote` or `wrangler d1 ... --remote` against
  `halalfood-world`. Production migrations are applied by a human.
- Backfill data in a migration. Write a script under `apps/web/scripts/` with a
  dry-run default instead (see `backfill-place-coordinates.ts`).

## PR notes

Say in the PR description that it contains a migration and what it adds. The
PR preview creates `halalfood-world-pr-<n>` and applies all migrations to it,
so the preview proves the SQL applies cleanly from empty.
