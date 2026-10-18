import type { database } from "@/lib/db";

export type ScoutDatabase = Awaited<ReturnType<typeof database>>;

/** What every Scout tool needs: the database, the public origin for links, and a clock. */
export type ScoutDeps = {
  db: ScoutDatabase;
  /** No trailing slash: https://halalfood.world, or a Preview's own origin. */
  origin: string;
  now: () => number;
};
