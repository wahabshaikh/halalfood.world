/**
 * Lists: ranked lists, plans with friends, and moderator guides (spec §5.3).
 */
import { sql, type SQL } from "drizzle-orm";
import { database } from "../db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export const LIST_KINDS = ["ranked", "plan", "guide"] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export const LIST_VISIBILITIES = ["public", "followers", "private"] as const;
export type ListVisibility = (typeof LIST_VISIBILITIES)[number];

export const KIND_LABEL: Record<ListKind, string> = { ranked: "Ranked", plan: "Plan", guide: "Guide" };

export type ListSummary = {
  id: string;
  title: string;
  kind: ListKind;
  visibility: ListVisibility;
  citySlug: string | null;
  items: number;
  coverKey: string | null;
  coverPlaceId: string | null;
  coverName: string | null;
  ownerHandle: string | null;
  ownerName: string | null;
  updatedAt: number;
};

const SUMMARY_COLUMNS = sql.raw(`
  l.id, l.title, l.kind, l.visibility, l.city_slug, l.updated_at,
  (SELECT count(*) FROM list_items i WHERE i.list_id = l.id) AS items,
  (SELECT i.place_id FROM list_items i WHERE i.list_id = l.id ORDER BY i.position LIMIT 1) AS cover_place_id,
  (SELECT p.name FROM list_items i JOIN places p ON p.id = i.place_id WHERE i.list_id = l.id ORDER BY i.position LIMIT 1) AS cover_name,
  (SELECT ph.r2_key FROM list_items i JOIN place_photos ph ON ph.place_id = i.place_id
     WHERE i.list_id = l.id ORDER BY i.position, ph.created_at DESC LIMIT 1) AS cover_key,
  pr.handle AS owner_handle, pr.display_name AS owner_name
`);

export function toListSummary(row: Record<string, unknown>): ListSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    kind: row.kind as ListKind,
    visibility: row.visibility as ListVisibility,
    citySlug: (row.city_slug as string | null) ?? null,
    items: Number(row.items ?? 0),
    coverKey: (row.cover_key as string | null) ?? null,
    coverPlaceId: (row.cover_place_id as string | null) ?? null,
    coverName: (row.cover_name as string | null) ?? null,
    ownerHandle: (row.owner_handle as string | null) ?? null,
    ownerName: (row.owner_name as string | null) ?? (row.owner_handle as string | null) ?? null,
    updatedAt: Number(row.updated_at),
  };
}

/** Lists the viewer may see (spec §9): public, followers to accepted followers, members always. */
export function visibleList(viewerId: string | null): SQL {
  if (!viewerId) return sql`l.visibility = 'public'`;
  return sql`(
    l.owner_id = ${viewerId}
    OR EXISTS (SELECT 1 FROM list_members m WHERE m.list_id = l.id AND m.user_id = ${viewerId})
    OR (
      NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = l.owner_id)
        OR (b.blocker_id = l.owner_id AND b.blocked_id = ${viewerId}))
      AND (
        l.visibility = 'public'
        OR (l.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f
          WHERE f.follower_id = ${viewerId} AND f.followee_id = l.owner_id AND f.status = 'accepted'))
      )
    )
  )`;
}

/** Someone's own lists, newest first. `viewerId` decides which are visible. */
export async function listsOwnedBy(ownerId: string, viewerId: string | null, client: Client = database()): Promise<ListSummary[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${SUMMARY_COLUMNS}
    FROM lists l LEFT JOIN profiles pr ON pr.user_id = l.owner_id
    WHERE l.owner_id = ${ownerId} AND ${visibleList(viewerId)}
    ORDER BY l.updated_at DESC LIMIT 100
  `);
  return rows.map(toListSummary);
}
