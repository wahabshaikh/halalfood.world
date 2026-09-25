import { sql } from "drizzle-orm";
import { database } from "../db";

/** Keep the public board small enough for a fast anonymous read. */
export const CONTRIBUTOR_LEADERBOARD_LIMIT = 50;
export const CONTRIBUTOR_LEADERBOARD_MAX_LIMIT = 100;
export const CONTRIBUTOR_LEADERBOARD_CACHE_CONTROL =
  "public, max-age=60, s-maxage=60";

/** Points favour contributions that take more effort to add to the map. */
export const CONTRIBUTOR_SCORE_WEIGHTS = {
  placesAdded: 10,
  verificationsSubmitted: 8,
  reviews: 5,
  photos: 3,
  ratings: 1,
} as const;

export type ContributorContributionCounts = {
  placesAdded: number;
  verificationsSubmitted: number;
  reviews: number;
  photos: number;
  ratings: number;
};

export type ContributorAggregate = {
  userId: string;
  name: string | null;
  contributions: ContributorContributionCounts;
};

export type RankedContributor = {
  rank: number;
  displayName: string;
  contributions: ContributorContributionCounts;
  score: number;
};

function boundedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) return CONTRIBUTOR_LEADERBOARD_LIMIT;
  return Math.min(value, CONTRIBUTOR_LEADERBOARD_MAX_LIMIT);
}

function countValue(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}

function normalizeCounts(
  counts: ContributorContributionCounts,
): ContributorContributionCounts {
  return {
    placesAdded: countValue(counts.placesAdded),
    verificationsSubmitted: countValue(counts.verificationsSubmitted),
    reviews: countValue(counts.reviews),
    photos: countValue(counts.photos),
    ratings: countValue(counts.ratings),
  };
}

export function scoreContributor(
  contributions: ContributorContributionCounts,
): number {
  return (
    contributions.placesAdded * CONTRIBUTOR_SCORE_WEIGHTS.placesAdded +
    contributions.verificationsSubmitted *
      CONTRIBUTOR_SCORE_WEIGHTS.verificationsSubmitted +
    contributions.reviews * CONTRIBUTOR_SCORE_WEIGHTS.reviews +
    contributions.photos * CONTRIBUTOR_SCORE_WEIGHTS.photos +
    contributions.ratings * CONTRIBUTOR_SCORE_WEIGHTS.ratings
  );
}

/** A short, deterministic handle that never exposes the underlying user id. */
export function anonymizedContributorHandle(userId: string): string {
  let hash = 2166136261;
  for (const character of userId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  const shortHash = (hash >>> 0).toString(16).padStart(8, "0").slice(0, 4);
  return `Contributor · ${shortHash}`;
}

export function contributorDisplayName(
  name: string | null | undefined,
  userId: string,
): string {
  const trimmed = name?.trim();
  return trimmed || anonymizedContributorHandle(userId);
}

function nameSortKey(row: ContributorAggregate): string {
  return row.name?.trim().toLocaleLowerCase("en-US") ?? "";
}

/**
 * Rank rows by score, then places added, then normalized name, with the user
 * id as a stable final tie-breaker. The id is never returned to the page.
 */
function compareContributors(
  left: ContributorAggregate,
  right: ContributorAggregate,
): number {
  const scoreDifference =
    scoreContributor(right.contributions) - scoreContributor(left.contributions);
  if (scoreDifference) return scoreDifference;

  const placeDifference =
    right.contributions.placesAdded - left.contributions.placesAdded;
  if (placeDifference) return placeDifference;

  const nameDifference = nameSortKey(left).localeCompare(nameSortKey(right), "en");
  if (nameDifference) return nameDifference;
  return left.userId.localeCompare(right.userId);
}

export function rankContributors(
  rows: readonly ContributorAggregate[],
  limit = CONTRIBUTOR_LEADERBOARD_LIMIT,
): RankedContributor[] {
  return rows
    .map((row) => ({
      ...row,
      name: row.name?.trim() || null,
      contributions: normalizeCounts(row.contributions),
    }))
    .filter((row) => row.userId.trim().length > 0)
    .sort(compareContributors)
    .slice(0, boundedLimit(limit))
    .map((row, index) => ({
      rank: index + 1,
      displayName: contributorDisplayName(row.name, row.userId),
      contributions: row.contributions,
      score: scoreContributor(row.contributions),
    }));
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export interface ContributorLeaderboardRepository {
  list(limit: number): Promise<ContributorAggregate[]>;
}

function mapContributorRow(
  row: Record<string, unknown>,
): ContributorAggregate | null {
  if (typeof row.user_id !== "string" || !row.user_id) return null;
  return {
    userId: row.user_id,
    name: typeof row.user_name === "string" ? row.user_name : null,
    contributions: {
      placesAdded: countValue(row.places_added),
      verificationsSubmitted: countValue(row.verifications_submitted),
      reviews: countValue(row.reviews),
      photos: countValue(row.photos),
      ratings: countValue(row.ratings),
    },
  };
}

/** D1-backed aggregation for the public contributor board. */
export function d1ContributorLeaderboardRepository(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): ContributorLeaderboardRepository {
  return {
    async list(limit) {
      const safeLimit = boundedLimit(limit);
      const db = await client;
      const rows = await db.all<Record<string, unknown>>(sql`
        WITH contribution_events AS (
          SELECT submitted_by_user_id AS user_id, 'places_added' AS signal
          FROM places
          WHERE submitted_by_user_id IS NOT NULL
          UNION ALL
          SELECT submitted_by_user_id AS user_id, 'verifications_submitted' AS signal
          FROM place_halal_verifications
          UNION ALL
          SELECT user_id, 'reviews' AS signal
          FROM place_reviews
          UNION ALL
          SELECT user_id, 'photos' AS signal
          FROM place_photos
          UNION ALL
          SELECT user_id, 'ratings' AS signal
          FROM place_ratings
        ), contribution_counts AS (
          SELECT
            user_id,
            COUNT(*) FILTER (WHERE signal = 'places_added') AS places_added,
            COUNT(*) FILTER (WHERE signal = 'verifications_submitted') AS verifications_submitted,
            COUNT(*) FILTER (WHERE signal = 'reviews') AS reviews,
            COUNT(*) FILTER (WHERE signal = 'photos') AS photos,
            COUNT(*) FILTER (WHERE signal = 'ratings') AS ratings
          FROM contribution_events
          GROUP BY user_id
        )
        SELECT
          c.user_id,
          NULLIF(TRIM(u.name), '') AS user_name,
          c.places_added,
          c.verifications_submitted,
          c.reviews,
          c.photos,
          c.ratings
        FROM contribution_counts AS c
        LEFT JOIN "user" AS u ON u.id = c.user_id
        ORDER BY
          (
            c.places_added * ${CONTRIBUTOR_SCORE_WEIGHTS.placesAdded} +
            c.verifications_submitted * ${CONTRIBUTOR_SCORE_WEIGHTS.verificationsSubmitted} +
            c.reviews * ${CONTRIBUTOR_SCORE_WEIGHTS.reviews} +
            c.photos * ${CONTRIBUTOR_SCORE_WEIGHTS.photos} +
            c.ratings * ${CONTRIBUTOR_SCORE_WEIGHTS.ratings}
          ) DESC,
          c.places_added DESC,
          LOWER(COALESCE(NULLIF(TRIM(u.name), ''), '')) ASC,
          c.user_id ASC
        LIMIT ${safeLimit}
      `);
      return rows
        .map(mapContributorRow)
        .filter((row): row is ContributorAggregate => row !== null);
    },
  };
}

export async function getContributorLeaderboard(
  repository: ContributorLeaderboardRepository,
  limit = CONTRIBUTOR_LEADERBOARD_LIMIT,
): Promise<RankedContributor[]> {
  const safeLimit = boundedLimit(limit);
  return rankContributors(await repository.list(safeLimit), safeLimit);
}

export async function listContributors(
  limit = CONTRIBUTOR_LEADERBOARD_LIMIT,
  repository: ContributorLeaderboardRepository =
    d1ContributorLeaderboardRepository(),
): Promise<RankedContributor[]> {
  return getContributorLeaderboard(repository, limit);
}

/**
 * Levels are recognition only: they describe how much someone has helped,
 * and never change how their checks are reviewed.
 */
export const CONTRIBUTOR_LEVELS = [
  { name: "Newcomer", minScore: 0, blurb: "Welcome in. Every check counts." },
  { name: "Regular", minScore: 50, blurb: "You’ve helped a good few people decide." },
  { name: "Trusted", minScore: 200, blurb: "People lean on your checks." },
  { name: "Keeper", minScore: 600, blurb: "One of the people keeping the map honest." },
] as const;

export type ContributorLevel = (typeof CONTRIBUTOR_LEVELS)[number];

export function contributorLevel(score: number): ContributorLevel {
  const safe = Number.isFinite(score) ? score : 0;
  let level: ContributorLevel = CONTRIBUTOR_LEVELS[0];
  for (const candidate of CONTRIBUTOR_LEVELS) if (safe >= candidate.minScore) level = candidate;
  return level;
}

/** The next level and how many points are left, or null at the top. */
export function nextContributorLevel(
  score: number,
): { level: ContributorLevel; pointsToGo: number } | null {
  const safe = Number.isFinite(score) ? Math.max(0, score) : 0;
  const next = CONTRIBUTOR_LEVELS.find((level) => level.minScore > safe);
  return next ? { level: next, pointsToGo: next.minScore - safe } : null;
}
