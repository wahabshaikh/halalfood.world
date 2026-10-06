---
paths:
  - "migrations/**"
  - "lib/db/schema.ts"
---

# D1 migrations and schema

- Migrations are hand-written SQL in `migrations/NNNN_short_name.sql`, numbered one past the highest
  existing file. Never edit or renumber a migration that is on `main`: it has already run in production.
- Additive only: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE … ADD COLUMN`
  (nullable or with a default). No `DROP`/`RENAME` of anything the deployed Worker still reads.
  Removing something takes two releases: stop reading it, then drop it.
- Start the file with a one-line `--` comment saying what it adds and that it is additive. Comment
  non-obvious columns (units, enums, why it exists), like `migrations/0002_place_signals.sql`.
- Mirror every table/column in `lib/db/schema.ts` (Drizzle) in the same PR. Timestamps are epoch
  milliseconds in `INTEGER` columns.
- D1 is SQLite: no `ALTER COLUMN`, limited `ALTER TABLE`, FTS5 is available, statements run without
  an explicit transaction across files. Keep data backfills idempotent (`WHERE … IS NULL`).
- Sample data belongs in `seed/local.sql`, never in a migration.
- Apply and check locally: `pnpm db:migrate:local`, then run the affected tests/E2E.
- Remote apply is a human decision. Follow the `d1-migration` skill; it records a Time Travel bookmark first.
