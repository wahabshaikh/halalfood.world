/**
 * The Community leaderboard (spec §10, §6.22): points per city, this week or
 * all time. Private accounts, people who opted out, and suspended accounts
 * are never listed. Ties go to whoever reached the total first.
 */
import { sql } from "drizzle-orm";
import { weekStart } from "@halalfood/core/points";
import { database } from "../db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type Period = "week" | "all";

export type BoardRow = { rank: number; userId: string; handle: string; name: string; avatarKey: string | null; points: number };

export type Board = {
  rows: BoardRow[];
  /** The viewer's own standing: a row, hidden (private or opted out), or nothing yet. */
  me: { kind: "row"; row: BoardRow } | { kind: "hidden" } | { kind: "none" } | null;
};

export async function leaderboard(citySlug: string, period: Period, viewerId: string | null, client: Client = database(), now = Date.now()): Promise<Board> {
  const db = await client;
  const since = period === "week" ? weekStart(now) : 0;
  const rows = await db.all<Record<string, unknown>>(sql`
    WITH totals AS (
      SELECT pt.user_id, SUM(pt.points) AS points, MAX(pt.created_at) AS reached
      FROM points pt JOIN profiles pr ON pr.user_id = pt.user_id
      WHERE pt.city_slug = ${citySlug} AND pt.created_at >= ${since}
        AND pr.is_private = 0 AND pr.show_on_leaderboards = 1 AND pr.suspended_at IS NULL
      GROUP BY pt.user_id
    ),
    ranked AS (
      SELECT user_id, points, ROW_NUMBER() OVER (ORDER BY points DESC, reached ASC) AS rank FROM totals
    )
    SELECT r.rank, r.user_id, r.points, pr.handle, pr.display_name, pr.avatar_key
    FROM ranked r JOIN profiles pr ON pr.user_id = r.user_id
    WHERE r.rank <= 50 ${viewerId ? sql`OR r.user_id = ${viewerId}` : sql``}
    ORDER BY r.rank
  `);
  const toRow = (row: Record<string, unknown>): BoardRow => ({
    rank: Number(row.rank),
    userId: String(row.user_id),
    handle: String(row.handle),
    name: String(row.display_name ?? row.handle),
    avatarKey: (row.avatar_key as string | null) ?? null,
    points: Number(row.points),
  });
  const all = rows.map(toRow);
  const board = all.filter((row) => row.rank <= 50);
  if (!viewerId) return { rows: board, me: null };
  const mine = all.find((row) => row.userId === viewerId);
  if (mine) return { rows: board, me: { kind: "row", row: mine } };
  const [profile] = await db.all<{ is_private: number; show_on_leaderboards: number }>(sql`
    SELECT is_private, show_on_leaderboards FROM profiles WHERE user_id = ${viewerId}
  `);
  const hidden = profile && (Number(profile.is_private) === 1 || Number(profile.show_on_leaderboards) === 0);
  return { rows: board, me: hidden ? { kind: "hidden" } : { kind: "none" } };
}
