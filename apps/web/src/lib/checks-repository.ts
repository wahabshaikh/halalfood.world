/**
 * Checks are the only input to halal status. Writing one stores it with its
 * dishes and photos, recomputes the place's `place_status` projection, records
 * any change, and awards points (spec §2, §10).
 */
import { sql, type SQL } from "drizzle-orm";
import {
  FACTS,
  deriveStatus,
  statusProgress,
  type Answer,
  type CheckForStatus,
  type DerivedStatus,
  type PlaceStatus,
} from "@halalfood/core/halal";
import type { CheckInput, Verdict } from "@halalfood/core/check";
import { POINTS, pointDay } from "@halalfood/core/points";
import { database } from "../db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export async function runBatch(db: DatabaseClient, statements: SQL[]) {
  if (!statements.length) return;
  // D1 rejects BEGIN; a batch is its transaction and rolls back as a whole.
  // Raw SQL goes straight to the D1 client: drizzle's batch() only takes
  // query builders.
  const client = (db as unknown as { $client: D1Like }).$client;
  const dialect = (db as unknown as { dialect: { sqlToQuery(query: SQL): { sql: string; params: unknown[] } } }).dialect;
  await client.batch(
    statements.map((statement) => {
      const query = dialect.sqlToQuery(statement);
      return client.prepare(query.sql).bind(...query.params);
    }),
  );
}

type D1Like = {
  prepare(sql: string): { bind(...params: unknown[]): unknown };
  batch(statements: unknown[]): Promise<unknown>;
};

/* ------------------------------------------------------------------------ */
/* Status                                                                    */
/* ------------------------------------------------------------------------ */

export type StatusChange = {
  id: string;
  fromStatus: PlaceStatus["kind"];
  toStatus: PlaceStatus["kind"];
  fact: string | null;
  fromValue: string | null;
  toValue: string | null;
};

export type Recompute = {
  before: PlaceStatus;
  after: PlaceStatus;
  derived: DerivedStatus;
  changes: StatusChange[];
  /** Authors who should get helped-verify points: set when the place first verifies. */
  firstVerifiedBy: string[];
  /** Each fact's value before this recompute. */
  previousValues: Record<(typeof FACTS)[number], "yes" | "no" | null>;
};

type StatusRow = {
  status: PlaceStatus["kind"];
  progress: number;
  verified_at: number | null;
} & Record<`${(typeof FACTS)[number]}_value`, "yes" | "no" | null> &
  Record<`${(typeof FACTS)[number]}_settled`, "yes" | "no" | null> &
  Record<`${(typeof FACTS)[number]}_streak`, number>;

function asStatus(row: StatusRow | undefined): PlaceStatus {
  if (!row || row.status === "unchecked") return { kind: "unchecked" };
  if (row.status === "verified") return { kind: "verified" };
  return { kind: "checking", progress: row.progress >= 2 ? 2 : 1 };
}

async function loadChecksForStatus(db: DatabaseClient, placeId: string): Promise<CheckForStatus[]> {
  // check-visibility: status — every check counts toward the halal facts; nothing about authors leaves this function.
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT c.user_id, c.created_at, c.excluded, c.owned, c.certified, c.pork, c.alcohol,
      u.created_at AS author_created_at, pr.suspended_at
    FROM checks c
    JOIN "user" u ON u.id = c.user_id
    LEFT JOIN profiles pr ON pr.user_id = c.user_id
    WHERE c.place_id = ${placeId}
  `);
  return rows.map((row) => ({
    userId: String(row.user_id),
    createdAt: Number(row.created_at),
    authorCreatedAt: Number(row.author_created_at),
    excluded: Number(row.excluded) === 1,
    authorSuspended: row.suspended_at !== null && row.suspended_at !== undefined,
    owned: (row.owned ?? null) as Answer,
    certified: (row.certified ?? null) as Answer,
    pork: (row.pork ?? null) as Answer,
    alcohol: (row.alcohol ?? null) as Answer,
  }));
}

/**
 * Rebuild one place's status projection from its checks. Writes the row, any
 * status changes, and helped-verify points the first time the place verifies.
 */
export async function recomputePlaceStatus(
  placeId: string,
  client: Client = database(),
  now = Date.now(),
): Promise<Recompute> {
  const db = await client;
  const [current] = await db.all<StatusRow>(sql`SELECT * FROM place_status WHERE place_id = ${placeId}`);
  const derived = deriveStatus(await loadChecksForStatus(db, placeId));
  const before = asStatus(current);
  const after = derived.status;
  const changes: StatusChange[] = [];
  if (before.kind !== after.kind)
    changes.push({ id: crypto.randomUUID(), fromStatus: before.kind, toStatus: after.kind, fact: null, fromValue: null, toValue: null });
  // A fact that settles on a different value from the one it last settled on
  // is worth telling savers about, even if the place stays where it was.
  const settled = {} as Record<(typeof FACTS)[number], "yes" | "no" | null>;
  for (const fact of FACTS) {
    const previous = current?.[`${fact}_settled`] ?? null;
    const next = derived.facts[fact];
    settled[fact] = next.settled ? next.value : previous;
    if (next.settled && previous && previous !== next.value)
      changes.push({ id: crypto.randomUUID(), fromStatus: before.kind, toStatus: after.kind, fact, fromValue: previous, toValue: next.value });
  }
  const firstVerification = after.kind === "verified" && !current?.verified_at;
  const verifiedAt = after.kind === "verified" ? (current?.verified_at ?? now) : (current?.verified_at ?? null);
  const firstVerifiedBy = firstVerification ? derived.authorsNewestFirst.slice(0, 3) : [];

  const statements: SQL[] = [
    sql`INSERT INTO place_status (
      place_id, status, progress, owned_value, owned_streak, owned_settled, certified_value,
      certified_streak, certified_settled, pork_value, pork_streak, pork_settled, alcohol_value,
      alcohol_streak, alcohol_settled, eligible_checks, last_checked_at, verified_at, updated_at
    ) VALUES (
      ${placeId}, ${after.kind}, ${statusProgress(after)},
      ${derived.facts.owned.value}, ${derived.facts.owned.streak}, ${settled.owned},
      ${derived.facts.certified.value}, ${derived.facts.certified.streak}, ${settled.certified},
      ${derived.facts.pork.value}, ${derived.facts.pork.streak}, ${settled.pork},
      ${derived.facts.alcohol.value}, ${derived.facts.alcohol.streak}, ${settled.alcohol},
      ${derived.eligibleChecks}, ${derived.lastCheckedAt}, ${verifiedAt}, ${now}
    )
    ON CONFLICT (place_id) DO UPDATE SET
      status = excluded.status, progress = excluded.progress,
      owned_value = excluded.owned_value, owned_streak = excluded.owned_streak, owned_settled = excluded.owned_settled,
      certified_value = excluded.certified_value, certified_streak = excluded.certified_streak, certified_settled = excluded.certified_settled,
      pork_value = excluded.pork_value, pork_streak = excluded.pork_streak, pork_settled = excluded.pork_settled,
      alcohol_value = excluded.alcohol_value, alcohol_streak = excluded.alcohol_streak, alcohol_settled = excluded.alcohol_settled,
      eligible_checks = excluded.eligible_checks, last_checked_at = excluded.last_checked_at,
      verified_at = excluded.verified_at, updated_at = excluded.updated_at`,
    ...changes.map(
      (change) => sql`INSERT INTO place_status_changes (id, place_id, from_status, to_status, fact, from_value, to_value, created_at)
        VALUES (${change.id}, ${placeId}, ${change.fromStatus}, ${change.toStatus}, ${change.fact}, ${change.fromValue}, ${change.toValue}, ${now})`,
    ),
  ];
  if (firstVerifiedBy.length) {
    const [place] = await db.all<{ city_slug: string }>(sql`SELECT city_slug FROM places WHERE id = ${placeId}`);
    for (const userId of firstVerifiedBy)
      statements.push(awardPoints(userId, "helped-verify", placeId, place?.city_slug ?? "", null, now));
  }
  await runBatch(db, statements);
  const previousValues = Object.fromEntries(FACTS.map((fact) => [fact, current?.[`${fact}_value`] ?? null])) as Recompute["previousValues"];
  return { before, after, derived, changes, firstVerifiedBy, previousValues };
}

export function awardPoints(
  userId: string,
  kind: keyof typeof POINTS,
  placeId: string,
  citySlug: string,
  checkId: string | null,
  now: number,
): SQL {
  return sql`INSERT OR IGNORE INTO points (id, user_id, kind, place_id, check_id, city_slug, points, day, created_at)
    VALUES (${crypto.randomUUID()}, ${userId}, ${kind}, ${placeId}, ${checkId}, ${citySlug}, ${POINTS[kind]}, ${pointDay(now)}, ${now})`;
}

/* ------------------------------------------------------------------------ */
/* Writing a check                                                           */
/* ------------------------------------------------------------------------ */

export type CreatedCheck = {
  checkId: string;
  deduped: boolean;
  recompute: Recompute | null;
};

export class CheckPlaceMissing extends Error {}

/** Statements that store a check, its dishes, its photos and its points. */
export function checkStatements(
  userId: string,
  placeId: string,
  citySlug: string,
  input: CheckInput,
  checkId: string,
  now: number,
): SQL[] {
  return [
    sql`INSERT INTO checks (id, user_id, place_id, owned, certified, pork, alcohol, verdict, note, shared, excluded, idempotency_key, created_at)
      VALUES (${checkId}, ${userId}, ${placeId}, ${input.owned}, ${input.certified}, ${input.pork}, ${input.alcohol},
        ${input.verdict}, ${input.note}, ${input.shared ? 1 : 0}, 0, ${input.idempotencyKey}, ${now})`,
    ...input.dishes.map(
      (name, position) => sql`INSERT INTO check_dishes (check_id, position, name) VALUES (${checkId}, ${position}, ${name})`,
    ),
    ...input.photoIds.map(
      (photoId) => sql`UPDATE place_photos SET check_id = ${checkId}
        WHERE id = ${photoId} AND user_id = ${userId} AND place_id = ${placeId} AND check_id IS NULL`,
    ),
    awardPoints(userId, "check", placeId, citySlug, checkId, now),
  ];
}

export async function createCheck(
  userId: string,
  placeId: string,
  input: CheckInput,
  client: Client = database(),
  now = Date.now(),
): Promise<CreatedCheck> {
  const db = await client;
  // check-visibility: owner-only — the caller's own retry.
  const existing = await db.all<{ id: string }>(sql`
    SELECT id FROM checks WHERE user_id = ${userId} AND idempotency_key = ${input.idempotencyKey} LIMIT 1
  `);
  if (existing[0]) return { checkId: existing[0].id, deduped: true, recompute: null };
  const [place] = await db.all<{ city_slug: string }>(sql`
    SELECT city_slug FROM places WHERE id = ${placeId} AND listing_status = 'listed'
  `);
  if (!place) throw new CheckPlaceMissing("That place could not be found.");
  const checkId = crypto.randomUUID();
  try {
    await runBatch(db, checkStatements(userId, placeId, place.city_slug, input, checkId, now));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique constraint failed/i.test(message)) {
      // check-visibility: owner-only — the caller's own retry.
      const again = await db.all<{ id: string }>(sql`
        SELECT id FROM checks WHERE user_id = ${userId} AND idempotency_key = ${input.idempotencyKey} LIMIT 1
      `);
      if (again[0]) return { checkId: again[0].id, deduped: true, recompute: null };
    }
    throw error;
  }
  const recompute = await recomputePlaceStatus(placeId, db, now);
  return { checkId, deduped: false, recompute };
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                   */
/* ------------------------------------------------------------------------ */

export type PlaceNote = {
  checkId: string;
  userId: string;
  handle: string | null;
  name: string;
  avatarKey: string | null;
  note: string;
  verdict: Verdict | null;
  createdAt: number;
};

/**
 * Shared, non-excluded notes, newest first, as the viewer may see them:
 * nothing across a block, private accounts only to accepted followers.
 */
export async function listPlaceNotes(
  placeId: string,
  viewerId: string | null,
  options: { limit?: number; before?: number } = {},
  client: Client = database(),
): Promise<PlaceNote[]> {
  const db = await client;
  const limit = Math.min(Math.max(options.limit ?? 2, 1), 50);
  // check-visibility: gated — shared notes from authors the viewer may see (visibleAuthor).
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT c.id, c.user_id, c.note, c.verdict, c.created_at, pr.handle, pr.display_name, pr.avatar_key, u.name
    FROM checks c
    JOIN "user" u ON u.id = c.user_id
    LEFT JOIN profiles pr ON pr.user_id = c.user_id
    WHERE c.place_id = ${placeId} AND c.excluded = 0 AND c.shared = 1 AND c.note IS NOT NULL
      AND pr.suspended_at IS NULL
      AND ${visibleAuthor(viewerId)}
      ${options.before ? sql`AND c.created_at < ${options.before}` : sql``}
    ORDER BY c.created_at DESC
    LIMIT ${limit}
  `);
  return rows.map((row) => ({
    checkId: String(row.id),
    userId: String(row.user_id),
    handle: (row.handle as string | null) ?? null,
    name: String(row.display_name ?? row.name ?? "Someone"),
    avatarKey: (row.avatar_key as string | null) ?? null,
    note: String(row.note),
    verdict: (row.verdict as Verdict | null) ?? null,
    createdAt: Number(row.created_at),
  }));
}

/** SQL: the author of `c` is visible to the viewer (spec §9). */
export function visibleAuthor(viewerId: string | null): SQL {
  if (!viewerId) return sql`COALESCE(pr.is_private, 0) = 0`;
  return sql`(
    c.user_id = ${viewerId}
    OR (
      NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = c.user_id)
        OR (b.blocker_id = c.user_id AND b.blocked_id = ${viewerId}))
      AND (
        COALESCE(pr.is_private, 0) = 0
        OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.followee_id = c.user_id AND f.status = 'accepted')
      )
    )
  )`;
}

/** The top dishes ordered at a place in the last year. */
export async function topDishes(
  placeId: string,
  options: { limit?: number; now?: number } = {},
  client: Client = database(),
): Promise<{ name: string; count: number }[]> {
  const db = await client;
  const since = (options.now ?? Date.now()) - 365 * 24 * 60 * 60 * 1000;
  // check-visibility: aggregate — anonymous dish counts, no author is exposed.
  const rows = await db.all<{ name: string; count: number }>(sql`
    SELECT min(d.name) AS name, count(*) AS count
    FROM check_dishes d JOIN checks c ON c.id = d.check_id
    WHERE c.place_id = ${placeId} AND c.excluded = 0 AND c.created_at >= ${since}
    GROUP BY lower(trim(d.name))
    ORDER BY count DESC, name
    LIMIT ${options.limit ?? 3}
  `);
  return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
}

export type MyCheck = {
  id: string;
  placeId: string;
  placeName: string;
  verdict: Verdict | null;
  createdAt: number;
  status: PlaceStatus;
};

export async function listMyChecks(userId: string, limit = 50, client: Client = database()): Promise<MyCheck[]> {
  const db = await client;
  // check-visibility: owner-only — the signed-in user's own checks.
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT c.id, c.place_id, c.verdict, c.created_at, p.name, s.status, s.progress
    FROM checks c JOIN places p ON p.id = c.place_id JOIN place_status s ON s.place_id = p.id
    WHERE c.user_id = ${userId}
    ORDER BY c.created_at DESC
    LIMIT ${limit}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    placeId: String(row.place_id),
    placeName: String(row.name),
    verdict: (row.verdict as Verdict | null) ?? null,
    createdAt: Number(row.created_at),
    status: asStatus(row as unknown as StatusRow),
  }));
}
