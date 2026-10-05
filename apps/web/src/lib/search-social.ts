import { sql } from "drizzle-orm";
import { database } from "../db";
import { containsText } from "./text-search";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type PersonResult = { userId: string; handle: string; name: string; avatarKey: string | null; homeCity: string | null };

/** People by name or @handle, never across a block, never suspended. */
export async function searchPeople(rawQuery: string, viewerId: string | null, limit = 5, client: Client = database()): Promise<PersonResult[]> {
  const q = rawQuery.replace(/^@/, "").trim();
  if (!q) return [];
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT pr.user_id, pr.handle, pr.display_name, pr.avatar_key, pr.home_city_slug
    FROM profiles pr
    WHERE pr.suspended_at IS NULL AND pr.onboarded_at IS NOT NULL
      AND (${containsText(sql`pr.handle`, q)} OR ${containsText(sql`pr.display_name`, q)})
      ${viewerId
        ? sql`AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = pr.user_id)
            OR (b.blocker_id = pr.user_id AND b.blocked_id = ${viewerId}))`
        : sql``}
    ORDER BY CASE WHEN lower(pr.handle) = lower(${q}) THEN 0 ELSE 1 END,
      (SELECT count(*) FROM follows f WHERE f.followee_id = pr.user_id AND f.status = 'accepted') DESC,
      pr.handle
    LIMIT ${limit}
  `);
  return rows.map((row) => ({
    userId: String(row.user_id),
    handle: String(row.handle),
    name: String(row.display_name ?? row.handle),
    avatarKey: (row.avatar_key as string | null) ?? null,
    homeCity: (row.home_city_slug as string | null) ?? null,
  }));
}

export type ListResult = {
  id: string;
  title: string;
  kind: "ranked" | "plan" | "guide";
  ownerName: string;
  items: number;
  saves: number;
  coverPlaceId: string | null;
};

/** Public lists and guides by title, most saved first. */
export async function searchLists(rawQuery: string, viewerId: string | null, limit = 5, client: Client = database()): Promise<ListResult[]> {
  const q = rawQuery.trim();
  if (!q) return [];
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT l.id, l.title, l.kind, COALESCE(pr.display_name, pr.handle, 'halalfood.world') AS owner_name,
      (SELECT count(*) FROM list_items i WHERE i.list_id = l.id) AS items,
      (SELECT count(*) FROM list_saves s WHERE s.list_id = l.id) AS saves,
      (SELECT i.place_id FROM list_items i WHERE i.list_id = l.id ORDER BY i.position LIMIT 1) AS cover_place_id
    FROM lists l LEFT JOIN profiles pr ON pr.user_id = l.owner_id
    WHERE l.visibility = 'public' AND ${containsText(sql`l.title`, q)}
      AND COALESCE(pr.is_private, 0) = 0 AND pr.suspended_at IS NULL
      ${viewerId
        ? sql`AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = l.owner_id)
            OR (b.blocker_id = l.owner_id AND b.blocked_id = ${viewerId}))`
        : sql``}
    ORDER BY CASE l.kind WHEN 'guide' THEN 0 ELSE 1 END, saves DESC, l.title
    LIMIT ${limit}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    kind: row.kind as ListResult["kind"],
    ownerName: row.kind === "guide" ? "halalfood.world" : String(row.owner_name),
    items: Number(row.items),
    saves: Number(row.saves),
    coverPlaceId: (row.cover_place_id as string | null) ?? null,
  }));
}
