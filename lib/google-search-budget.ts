import { sql } from "drizzle-orm";
import { database } from "@/lib/db";
import { readWorkerEnv } from "./worker-env";

/** Worker var. Unset or unreadable values use {@link GOOGLE_SEARCH_DAILY_CAP_DEFAULT}. */
export const GOOGLE_SEARCH_DAILY_CAP_VAR = "GOOGLE_SEARCH_DAILY_CAP";

/** Worker var for uncached Place Details calls. Same default as Text Search. */
export const GOOGLE_DETAILS_DAILY_CAP_VAR = "GOOGLE_DETAILS_DAILY_CAP";

/** Global ceiling on Places Text Search calls. Cache hits do not count. */
export const GOOGLE_SEARCH_DAILY_CAP_DEFAULT = 1000;

/** Global ceiling on uncached Place Details calls. Cache hits do not count. */
export const GOOGLE_DETAILS_DAILY_CAP_DEFAULT = 1000;

/**
 * Which daily counter to reserve. Search keeps the bare `YYYY-MM-DD` key so
 * existing rows stay put. Place Details uses `details:YYYY-MM-DD` in the same
 * table, so the two bills do not share a cap and no new migration is required.
 */
export type GoogleDailyBudgetKind = "search" | "details";

const MAX_CONFIGURED_CAP = 1_000_000;

export function parseGoogleSearchDailyCap(
  value: string | null | undefined,
  fallback = GOOGLE_SEARCH_DAILY_CAP_DEFAULT,
): number {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  if (parsed > MAX_CONFIGURED_CAP) return fallback;
  return parsed;
}

export async function readGoogleSearchDailyCap(): Promise<number> {
  return parseGoogleSearchDailyCap(await readWorkerEnv(GOOGLE_SEARCH_DAILY_CAP_VAR));
}

export async function readGoogleDetailsDailyCap(): Promise<number> {
  return parseGoogleSearchDailyCap(
    await readWorkerEnv(GOOGLE_DETAILS_DAILY_CAP_VAR),
    GOOGLE_DETAILS_DAILY_CAP_DEFAULT,
  );
}

/** Reserve one uncached Place Details call. False means the page or submission must continue without Google. */
export async function reserveGoogleDetailsCall(now: Date): Promise<boolean> {
  const cap = await readGoogleDetailsDailyCap();
  return d1GoogleSearchBudget().tryConsume(cap, now, "details");
}

/** UTC day key, so the counter resets at 00:00 UTC. */
export function googleSearchDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Primary key for one kind of Google call on one UTC day. */
export function googleDailyBudgetKey(now: Date, kind: GoogleDailyBudgetKind = "search"): string {
  const day = googleSearchDay(now);
  return kind === "details" ? `details:${day}` : day;
}

export type GoogleSearchBudget = {
  /**
   * Reserve one Google call for this UTC day.
   * Returns false when the day is already at `cap` and does not increment.
   * `kind` defaults to Text Search so existing callers keep the `YYYY-MM-DD` row.
   */
  tryConsume(cap: number, now: Date, kind?: GoogleDailyBudgetKind): Promise<boolean>;
};

type DatabaseClient = Awaited<ReturnType<typeof database>>;

/**
 * One global counter in D1. The Workers rate limiter is per location and
 * cannot count a whole day, so the bill is bounded here.
 */
export function d1GoogleSearchBudget(
  client?: DatabaseClient | Promise<DatabaseClient>,
): GoogleSearchBudget {
  return {
    async tryConsume(cap, now, kind = "search") {
      if (cap < 1) return false;
      const db = await (client ?? database());
      const rows = await db.all<{ call_count: number }>(sql`
        INSERT INTO google_search_daily (day, call_count, updated_at)
        VALUES (${googleDailyBudgetKey(now, kind)}, 1, ${now.getTime()})
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
