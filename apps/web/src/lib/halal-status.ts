import { sql } from "drizzle-orm";
import { database } from "../db";
import type { HalalStatus } from "@halalfood/core/halal-status-view";

export {
  formatHalalStatus,
  parseHalalStatus,
  type HalalStatus,
  type HalalStatusViewModel,
} from "@halalfood/core/halal-status-view";

/** Raw aggregate values returned by the status repository. */
export type HalalStatusAggregate = {
  approvedCount: unknown;
  latestReviewedAt: unknown;
};

export interface HalalStatusRepository {
  get(placeId: string): Promise<HalalStatusAggregate | null>;
}

function normalizedCount(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? value : null;

  if (typeof value !== "string") return null;
  const text = value;
  if (!/^(?:0|[1-9]\d*)$/.test(text)) return null;
  const count = Number(text);
  return Number.isSafeInteger(count) ? count : null;
}

/** Normalize D1, JSON, and Date values to a stable ISO timestamp. */
export function normalizeHalalStatusTimestamp(value: unknown): string | null {
  let timestamp: number | string | Date;
  if (value instanceof Date) {
    timestamp = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    timestamp = value;
  } else if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    timestamp = /^[-+]?\d+(?:\.\d+)?$/.test(trimmed)
      ? Number(trimmed)
      : trimmed;
  } else {
    return null;
  }

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Map a repository aggregate to the fail-closed public status contract. */
export function mapHalalStatus(aggregate: HalalStatusAggregate): HalalStatus {
  const approvedCount = normalizedCount(aggregate.approvedCount);
  if (approvedCount === null) return { status: "unavailable" };
  if (approvedCount === 0) {
    if (aggregate.latestReviewedAt !== null)
      return { status: "unavailable" };
    return {
      status: "unverified",
      approvedCount: 0,
      latestReviewedAt: null,
    };
  }
  const latestReviewedAt = normalizeHalalStatusTimestamp(
    aggregate.latestReviewedAt,
  );
  if (!latestReviewedAt) return { status: "unavailable" };
  return {
    status: "evidence-backed",
    approvedCount,
    latestReviewedAt,
  };
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

/** D1-backed public status aggregation. Pending and rejected rows are excluded. */
export function d1HalalStatusRepository(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): HalalStatusRepository {
  return {
    async get(placeId) {
      const db = await client;
      const rows = await db.all<Record<string, unknown>>(sql`
        SELECT
          p.id AS place_id,
          COUNT(v.id) AS approved_count,
          MAX(v.updated_at) AS latest_reviewed_at
        FROM places AS p
        LEFT JOIN place_halal_verifications AS v
          ON v.place_id = p.id
          AND v.status = 'approved'
        WHERE p.id = ${placeId}
          AND p.halal_confirmed = 1
      `);
      const row = rows[0];
      if (
        !row ||
        typeof row.place_id !== "string" ||
        row.place_id !== placeId ||
        row.approved_count === undefined ||
        row.latest_reviewed_at === undefined
      )
        return null;

      const approvedCount = normalizedCount(row.approved_count);
      if (approvedCount === null) return null;
      const latestReviewedAt = normalizeHalalStatusTimestamp(
        row.latest_reviewed_at,
      );
      if (approvedCount === 0 && row.latest_reviewed_at !== null) return null;
      if (approvedCount > 0 && !latestReviewedAt) return null;
      return {
        approvedCount,
        latestReviewedAt,
      };
    },
  };
}

/** Read one place's status and fail closed if the repository cannot answer. */
export async function getHalalStatus(
  repository: HalalStatusRepository,
  placeId: string,
): Promise<HalalStatus> {
  try {
    const aggregate = await repository.get(placeId);
    return aggregate ? mapHalalStatus(aggregate) : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
