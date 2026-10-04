import { sql } from "drizzle-orm";
import { database } from "../db";
import { readWorkerEnv } from "./worker-env";

/** Worker var. Unset or unreadable values use {@link GOOGLE_SEARCH_DAILY_CAP_DEFAULT}. */
export const GOOGLE_SEARCH_DAILY_CAP_VAR = "GOOGLE_SEARCH_DAILY_CAP";

/** Global ceiling on Places Text Search calls. Cache hits do not count. */
export const GOOGLE_SEARCH_DAILY_CAP_DEFAULT = 1000;

const MAX_CONFIGURED_CAP = 1_000_000;

export function parseGoogleSearchDailyCap(value: string | null | undefined): number {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) return GOOGLE_SEARCH_DAILY_CAP_DEFAULT;
  const parsed = Number(trimmed);
  if (parsed > MAX_CONFIGURED_CAP) return GOOGLE_SEARCH_DAILY_CAP_DEFAULT;
  return parsed;
}

export async function readGoogleSearchDailyCap(): Promise<number> {
  return parseGoogleSearchDailyCap(await readWorkerEnv(GOOGLE_SEARCH_DAILY_CAP_VAR));
}

/** UTC day key, so the counter resets at 00:00 UTC. */
export function googleSearchDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type GoogleSearchBudget = {
  /**
   * Reserve one Google call for this UTC day.
   * Returns false when the day is already at `cap` and does not increment.
   */
  tryConsume(cap: number, now: Date): Promise<boolean>;
};

type DatabaseClient = Awaited<ReturnType<typeof database>>;

/**
 * One global counter in D1. The Workers rate limiter is per location and
 * cannot count a whole day, so the bill is bounded here.
 */
export function d1GoogleSearchBudget(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): GoogleSearchBudget {
  return {
    async tryConsume(cap, now) {
      if (cap < 1) return false;
      const db = await client;
      const rows = await db.all<{ call_count: number }>(sql`
        INSERT INTO google_search_daily (day, call_count, updated_at)
        VALUES (${googleSearchDay(now)}, 1, ${now.getTime()})
        ON CONFLICT(day) DO UPDATE SET
          call_count = call_count + 1,
          updated_at = excluded.updated_at
        WHERE google_search_daily.call_count < ${cap}
        RETURNING call_count
      `);
      return rows.length > 0;
    },
  };
}
