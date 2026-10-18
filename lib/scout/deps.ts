import type { database } from "@/lib/db";

export type ScoutDatabase = Awaited<ReturnType<typeof database>>;

/** The Google Places key and daily caps Scout geocodes with. Absent: no geocoding (tests, a Worker without the key). */
export type ScoutGoogle = { apiKey: string | null; searchCap: number; detailsCap: number };

/** What every Scout tool needs: the database, the public origin for links, and a clock. */
export type ScoutDeps = {
  db: ScoutDatabase;
  /** No trailing slash: https://halalfood.world, or a Preview's own origin. */
  origin: string;
  now: () => number;
  google?: ScoutGoogle;
};
