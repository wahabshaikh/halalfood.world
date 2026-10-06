/**
 * The diner leaderboard: ranked by verified visits, not by volume.
 *
 * Corner ranks by places visited. Ranking by anything a diner can pile up by
 * pasting links would reward farming, so a visit only counts when it was
 * verified (location, receipt, reservation or payment), was not rewarded and
 * had no declared tie to the restaurant, and a place counts once per day. That
 * follows the anti-manipulation rules already used for ratings.
 *
 * A rank is context. It never feeds into a place's halal status or into how a
 * diner's own halal checks are reviewed.
 */

export const LEADERBOARD_WINDOWS = ["week", "all"] as const;
export type LeaderboardWindow = (typeof LEADERBOARD_WINDOWS)[number];

export const LEADERBOARD_WINDOW_LABELS: Record<LeaderboardWindow, string> = {
  week: "This week",
  all: "All time",
};

export function parseLeaderboardWindow(value: unknown): LeaderboardWindow {
  return (LEADERBOARD_WINDOWS as readonly unknown[]).includes(value)
    ? (value as LeaderboardWindow)
    : "week";
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Midnight UTC on the Monday that starts the week containing `now`. UTC keeps
 * one boundary for every city, so the board turns over at the same moment for
 * everyone and the cached rows stay valid for all of them.
 */
export function weekStart(now: number): number {
  const day = new Date(now);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return midnight - sinceMonday * DAY_MS;
}

/** The earliest visit time counted for a window, or null for all time. */
export function windowStart(window: LeaderboardWindow, now: number): number | null {
  return window === "week" ? weekStart(now) : null;
}

/** When the current week's board turns over. */
export function weekEnd(now: number): number {
  return weekStart(now) + 7 * DAY_MS;
}

export type DinerScore = {
  /** Public handle. Handles are unique, so rows never need an internal user id. */
  handle: string;
  displayName: string | null;
  avatarKey: string | null;
  /** Verified visits, one per place per day. */
  verified: number;
  /** Distinct places among them. */
  places: number;
};

export type RankedDiner = DinerScore & { rank: number };

/** Most verified visits first, then more distinct places, then handle for a stable order. */
export function compareDiners(a: DinerScore, b: DinerScore): number {
  return b.verified - a.verified || b.places - a.places || a.handle.localeCompare(b.handle);
}

export function rankDiners(rows: readonly DinerScore[], limit = 50): RankedDiner[] {
  return rows
    .filter((row) => row.verified > 0 && row.handle)
    .sort(compareDiners)
    .slice(0, Math.max(limit, 0))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export type Standing = {
  rank: number | null;
  verified: number;
  /** Diners ahead of you, nearest first, so the gap to pass is one lookup. */
  nextAhead: { handle: string; verified: number } | null;
  /** More verified visits needed to pass the next diner up. */
  toPass: number | null;
};

/** A diner's place in an already ranked list. Rank is null when they are not on it. */
export function standingOf(ranked: readonly RankedDiner[], handle: string, ownVerified = 0): Standing {
  const index = ranked.findIndex((row) => row.handle === handle);
  if (index === -1) {
    const last = ranked.at(-1) ?? null;
    return {
      rank: null,
      verified: ownVerified,
      nextAhead: last ? { handle: last.handle, verified: last.verified } : null,
      toPass: last ? Math.max(last.verified - ownVerified + 1, 1) : null,
    };
  }
  const own = ranked[index];
  const ahead = index > 0 ? ranked[index - 1] : null;
  return {
    rank: own.rank,
    verified: own.verified,
    nextAhead: ahead ? { handle: ahead.handle, verified: ahead.verified } : null,
    toPass: ahead ? Math.max(ahead.verified - own.verified + 1, 1) : null,
  };
}

/** "6 this week · 2 more to pass @mariam". */
export function standingLine(standing: Standing, window: LeaderboardWindow): string {
  const span = window === "week" ? "this week" : "verified";
  const own = window === "week" ? `${standing.verified} ${span}` : `${standing.verified} verified`;
  if (standing.toPass && standing.nextAhead)
    return `${own} · ${standing.toPass} more to pass @${standing.nextAhead.handle}`;
  if (standing.rank === 1) return `${own} · you’re in front`;
  return own;
}

export function verifiedLabel(count: number, window: LeaderboardWindow): string {
  return window === "week" ? `${count} verified this week` : `${count} verified`;
}

/** How the board explains itself, so nobody wonders why pasting links does nothing. */
export const LEADERBOARD_RULES =
  "Ranked by verified visits: confirmed by location, receipt, reservation or payment, not rewarded, and counted once per place per day. Sharing links or logging without proof doesn’t move you up.";

/** The most diners a ranking reads, so the cached query stays small. */
export const LEADERBOARD_DEPTH = 500;
