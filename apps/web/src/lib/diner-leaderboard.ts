/**
 * D1 access for the diner leaderboard: verified visits this week and all time,
 * for one city or everywhere.
 *
 * The ranked rows are the same for every visitor and hold only public handles,
 * so they go through the read cache. A viewer's own standing is worked out from
 * those rows, and only falls back to a query when they are not in the top of
 * the board. Rank never feeds into a place's halal status.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  LEADERBOARD_DEPTH,
  rankDiners,
  standingOf,
  windowStart,
  type DinerScore,
  type LeaderboardWindow,
  type RankedDiner,
  type Standing,
} from "@halalfood/core/leaderboard";
import { cachedRead } from "./read-cache";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

const DAY = 86_400_000;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/**
 * A verified visit is confirmed by location, receipt, reservation or payment,
 * not rewarded, with no declared tie to the restaurant. A place counts once per
 * day, so logging the same table ten times is one visit.
 */
const VERIFIED_VISITS = sql`
  FROM place_visits AS v
  LEFT JOIN place_check_ins AS c ON c.visit_id = v.id
  INNER JOIN places AS pl ON pl.id = v.place_id
  INNER JOIN user_profiles AS p ON p.user_id = v.user_id
  WHERE v.verification_method <> 'none'
    AND v.verification_confidence <> 'none'
    AND COALESCE(c.incentivized, 0) = 0
    AND COALESCE(c.relationship, 'none') = 'none'
`;

function windowFilter(window: LeaderboardWindow, now: number) {
  const start = windowStart(window, now);
  return start === null
    ? sql`AND v.visited_at <= ${now}`
    : sql`AND v.visited_at >= ${start} AND v.visited_at <= ${now}`;
}

const COUNTS = sql`
  COUNT(DISTINCT v.place_id || ':' || CAST(v.visited_at / ${DAY} AS INTEGER)) AS verified,
  COUNT(DISTINCT v.place_id) AS places
`;

/** Ranked diners for a window, or null-city for global. Up to the board's depth. */
async function loadRanking(
  window: LeaderboardWindow,
  citySlug: string | null,
  now: number,
  client: Client,
): Promise<RankedDiner[]> {
  const db = await client;
  const cityFilter = citySlug ? sql`AND pl.city_slug = ${citySlug}` : sql``;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT p.handle, p.display_name, p.avatar_key, ${COUNTS}
    ${VERIFIED_VISITS}
      AND p.onboarded_at IS NOT NULL AND p.is_private = 0 AND p.show_on_leaderboards = 1
      ${windowFilter(window, now)} ${cityFilter}
    GROUP BY p.user_id
    ORDER BY verified DESC, places DESC, p.handle ASC
    LIMIT ${LEADERBOARD_DEPTH}
  `);
  const scores: DinerScore[] = rows.map((row) => ({
    handle: String(row.handle),
    displayName: typeof row.display_name === "string" && row.display_name ? row.display_name : null,
    avatarKey: typeof row.avatar_key === "string" && row.avatar_key ? row.avatar_key : null,
    verified: num(row.verified),
    places: num(row.places),
  }));
  return rankDiners(scores, LEADERBOARD_DEPTH);
}

/** The board is cached briefly. The week is in the key, so it turns over on its own. */
export function listRankedDiners(
  window: LeaderboardWindow,
  citySlug: string | null = null,
  now = Date.now(),
  client?: Client,
): Promise<RankedDiner[]> {
  const load = () => loadRanking(window, citySlug, now, client ?? database());
  if (client) return load();
  const period = windowStart(window, now) ?? "all";
  return cachedRead(`leaderboard:diners:v1:${window}:${period}:${citySlug ?? "global"}`, 5 * 60, load);
}

export type ViewerStanding = {
  /** Whether the diner appears on the board at all. */
  listed: boolean;
  /** Why they do not, so the page can say so plainly. */
  hiddenReason: "private-account" | "opted-out" | "not-onboarded" | null;
  standing: Standing;
};

/**
 * A signed-in diner's own row. Someone outside the top of the board is counted
 * with one query instead of a second full ranking.
 */
export async function getViewerStanding(
  userId: string,
  window: LeaderboardWindow,
  citySlug: string | null = null,
  now = Date.now(),
  client?: Client,
): Promise<ViewerStanding | null> {
  const db = await (client ?? database());
  const profile = (
    await db.all<Record<string, unknown>>(sql`
      SELECT handle, is_private, show_on_leaderboards, onboarded_at
      FROM user_profiles WHERE user_id = ${userId} LIMIT 1
    `)
  )[0];
  if (!profile) return null;
  const handle = String(profile.handle);
  const hiddenReason =
    profile.onboarded_at === null || profile.onboarded_at === undefined
      ? "not-onboarded"
      : profile.is_private === 1 || profile.is_private === true
        ? "private-account"
        : profile.show_on_leaderboards === 0 || profile.show_on_leaderboards === false
          ? "opted-out"
          : null;

  const ranked = await listRankedDiners(window, citySlug, now, client);
  const onBoard = ranked.find((row) => row.handle === handle);
  let verified = onBoard?.verified ?? 0;
  if (!onBoard) {
    const cityFilter = citySlug ? sql`AND pl.city_slug = ${citySlug}` : sql``;
    const own = (
      await db.all<Record<string, unknown>>(sql`
        SELECT ${COUNTS}
        ${VERIFIED_VISITS}
          AND v.user_id = ${userId} ${windowFilter(window, now)} ${cityFilter}
      `)
    )[0];
    verified = num(own?.verified);
  }
  const standing = standingOf(ranked, handle, verified);
  return { listed: hiddenReason === null && verified > 0, hiddenReason, standing };
}
