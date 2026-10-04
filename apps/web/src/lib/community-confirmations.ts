/**
 * One corroboration per person on a public halal check or check-in.
 * Confirming your own target is refused. A second confirm is the same row.
 */

import { sql } from "drizzle-orm";
import { isUniqueConstraint } from "./domain-error";
import { database } from "../db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export type ConfirmationTarget = "verification" | "check-in";

export type ConfirmationResult =
  | { ok: true; confirmCount: number; created: boolean }
  | { ok: false; reason: "own" | "not-found" };

type TargetAccess =
  | { state: "ok" }
  | { state: "own" }
  | { state: "missing" };

async function targetAccess(
  db: DatabaseClient,
  userId: string,
  targetType: ConfirmationTarget,
  targetId: string,
): Promise<TargetAccess> {
  if (targetType === "verification") {
    const rows = await db.all<{
      submitted_by_user_id?: unknown;
      status?: unknown;
      visibility?: unknown;
    }>(sql`
      SELECT v.submitted_by_user_id, v.status, v.visibility
      FROM place_halal_verifications AS v
      INNER JOIN places AS p ON p.id = v.place_id
      WHERE v.id = ${targetId}
        AND p.halal_confirmed = 1 AND p.listing_status = 'listed'
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return { state: "missing" };
    if (row.submitted_by_user_id === userId) return { state: "own" };
    if (row.status !== "approved" || row.visibility !== "public") return { state: "missing" };
    return { state: "ok" };
  }

  const rows = await db.all<{ user_id?: unknown; visibility?: unknown }>(sql`
    SELECT v.user_id, v.visibility
    FROM place_visits AS v
    INNER JOIN place_check_ins AS c ON c.visit_id = v.id
    INNER JOIN places AS p ON p.id = v.place_id
    WHERE v.id = ${targetId}
      AND p.halal_confirmed = 1 AND p.listing_status = 'listed'
    LIMIT 1
  `);
  const row = rows[0];
  if (!row || row.visibility !== "public") return { state: "missing" };
  if (row.user_id === userId) return { state: "own" };
  return { state: "ok" };
}

async function confirmCount(
  db: DatabaseClient,
  targetType: ConfirmationTarget,
  targetId: string,
): Promise<number> {
  const rows = await db.all<{ n?: unknown }>(sql`
    SELECT COUNT(*) AS n FROM community_confirmations
    WHERE target_type = ${targetType} AND target_id = ${targetId}
  `);
  const n = rows[0]?.n;
  return typeof n === "number" ? n : Number(n ?? 0);
}

export async function confirmCommunityTarget(
  userId: string,
  targetType: ConfirmationTarget,
  targetId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<ConfirmationResult> {
  const db = await client;
  const access = await targetAccess(db, userId, targetType, targetId);
  if (access.state === "missing") return { ok: false, reason: "not-found" };
  if (access.state === "own") return { ok: false, reason: "own" };

  const existing = await db.all<{ id?: unknown }>(sql`
    SELECT id FROM community_confirmations
    WHERE target_type = ${targetType} AND target_id = ${targetId} AND user_id = ${userId}
    LIMIT 1
  `);
  const created = !existing[0];
  if (created) {
    try {
      await db.run(sql`
        INSERT INTO community_confirmations (
          id, target_type, target_id, user_id, created_at
        ) VALUES (
          ${crypto.randomUUID()}, ${targetType}, ${targetId}, ${userId}, ${Date.now()}
        )
      `);
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
    }
  }
  return { ok: true, confirmCount: await confirmCount(db, targetType, targetId), created };
}
