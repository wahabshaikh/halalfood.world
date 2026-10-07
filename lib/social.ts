/**
 * Read-side helpers for the social graph that discovery needs. Writes live in
 * the people repository.
 */
import { sql } from "drizzle-orm";
import { database } from "@/lib/db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

/** People this user follows (accepted), minus anyone either side has blocked. */
export async function followeeIds(userId: string, client: Client = database()): Promise<string[]> {
  const db = await client;
  const rows = await db.all<{ followee_id: string }>(sql`
    SELECT f.followee_id FROM follows f
    WHERE f.follower_id = ${userId} AND f.status = 'accepted'
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = f.followee_id)
        OR (b.blocker_id = f.followee_id AND b.blocked_id = ${userId}))
  `);
  return rows.map((row) => row.followee_id);
}

export type FriendLine = {
  userId: string;
  name: string;
  handle: string | null;
  avatarKey: string | null;
  line: string;
  others: number;
  /** The friend's check behind the line, when it came from a check. */
  checkId: string | null;
  note: string | null;
  people: { userId: string; name: string }[];
};

/**
 * "Zaid and 2 friends loved this" for each place: from followees' latest
 * shared checks that liked or loved it, else "Farah wants to try this" from a save.
 */
export async function friendLines(
  viewerId: string,
  placeIds: string[],
  client: Client = database(),
): Promise<Map<string, FriendLine>> {
  const out = new Map<string, FriendLine>();
  if (!placeIds.length) return out;
  const friends = await followeeIds(viewerId, client);
  if (!friends.length) return out;
  const db = await client;
  const places = sql.join(placeIds.map((id) => sql`${id}`), sql`, `);
  const people = sql.join(friends.map((id) => sql`${id}`), sql`, `);
  // check-visibility: audience — shared checks by people the viewer follows (accepted follows only).
  const loved = await db.all<Record<string, unknown>>(sql`
    SELECT c.id, c.note, c.place_id, c.user_id, c.verdict, c.created_at, pr.display_name, pr.handle, pr.avatar_key, u.name
    FROM checks c JOIN "user" u ON u.id = c.user_id LEFT JOIN profiles pr ON pr.user_id = c.user_id
    WHERE c.place_id IN (${places}) AND c.user_id IN (${people}) AND c.shared = 1 AND c.excluded = 0
      AND c.verdict IN ('loved', 'liked')
    ORDER BY c.created_at DESC
  `);
  const byPlace = new Map<string, Record<string, unknown>[]>();
  for (const row of loved) {
    const list = byPlace.get(String(row.place_id)) ?? [];
    if (!list.some((other) => other.user_id === row.user_id)) list.push(row);
    byPlace.set(String(row.place_id), list);
  }
  for (const [placeId, rows] of byPlace) {
    const first = rows[0];
    const name = String(first.display_name ?? first.name ?? "A friend").split(" ")[0];
    const verb = rows.some((row) => row.verdict === "loved") ? "loved" : "liked";
    const others = rows.length - 1;
    out.set(placeId, {
      userId: String(first.user_id),
      name,
      handle: (first.handle as string | null) ?? null,
      avatarKey: (first.avatar_key as string | null) ?? null,
      others,
      checkId: String(first.id),
      note: (first.note as string | null) ?? null,
      people: rows.slice(0, 3).map((row) => ({ userId: String(row.user_id), name: String(row.display_name ?? row.name ?? "Friend") })),
      line: others ? `${name} and ${others} ${others === 1 ? "friend" : "friends"} ${verb} this` : `${name} ${verb} this`,
    });
  }
  const missing = placeIds.filter((id) => !out.has(id));
  if (!missing.length) return out;
  const saves = await db.all<Record<string, unknown>>(sql`
    SELECT sp.place_id, sp.user_id, pr.display_name, pr.handle, pr.avatar_key, u.name
    FROM saved_places sp JOIN "user" u ON u.id = sp.user_id LEFT JOIN profiles pr ON pr.user_id = sp.user_id
    WHERE sp.place_id IN (${sql.join(missing.map((id) => sql`${id}`), sql`, `)}) AND sp.user_id IN (${people})
      AND COALESCE(pr.is_private, 0) = 0
    ORDER BY sp.created_at DESC
  `);
  for (const row of saves) {
    const placeId = String(row.place_id);
    if (out.has(placeId)) continue;
    const name = String(row.display_name ?? row.name ?? "A friend").split(" ")[0];
    out.set(placeId, {
      userId: String(row.user_id),
      name,
      handle: (row.handle as string | null) ?? null,
      avatarKey: (row.avatar_key as string | null) ?? null,
      others: 0,
      checkId: null,
      note: null,
      people: [{ userId: String(row.user_id), name }],
      line: `${name} wants to try this`,
    });
  }
  return out;
}
