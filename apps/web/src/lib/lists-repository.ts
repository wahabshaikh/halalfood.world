/** D1 access for personal lists and their ordered items. */

import { eq, sql } from "drizzle-orm";
import { database } from "../db";
import { placeListItems, placeLists } from "../db/schema";
import type { PlaceList, ValidatedList } from "@halalfood/core/place-lists";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number(value ?? 0) || 0;
}

function mapList(row: Record<string, unknown>): PlaceList {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title ?? ""),
    slug: String(row.slug ?? ""),
    description: typeof row.description === "string" ? row.description : null,
    ranked: row.ranked === 1 || row.ranked === true,
    visibility:
      row.visibility === "private"
        ? "private"
        : row.visibility === "unlisted"
          ? "unlisted"
          : "public",
    itemCount: num(row.item_count),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

const LIST_SELECT = sql`
  SELECT l.*, (
    SELECT COUNT(*) FROM place_list_items AS i WHERE i.list_id = l.id
  ) AS item_count
  FROM place_lists AS l
`;

export async function listListsForUser(
  userId: string,
  options: { includePrivate: boolean },
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PlaceList[]> {
  const db = await client;
  const visibility = options.includePrivate
    ? sql`1 = 1`
    : sql`l.visibility = 'public'`;
  const rows = await db.all<Record<string, unknown>>(sql`
    ${LIST_SELECT}
    WHERE l.user_id = ${userId} AND ${visibility}
    ORDER BY l.updated_at DESC
    LIMIT 200
  `);
  return rows.map(mapList);
}

export async function getList(
  listId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PlaceList | null> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    ${LIST_SELECT} WHERE l.id = ${listId} LIMIT 1
  `);
  return rows[0] ? mapList(rows[0]) : null;
}

export type ListPlace = {
  placeId: string;
  position: number;
  note: string | null;
  name: string;
  citySlug: string;
  streetAddress: string;
  lat: number | null;
  lng: number | null;
};

export async function listItems(
  listId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<ListPlace[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT i.place_id, i.position, i.note, p.name, p.city_slug, p.street_address,
      p.lat, p.lng
    FROM place_list_items AS i
    INNER JOIN places AS p ON p.id = i.place_id
    WHERE i.list_id = ${listId} AND p.halal_confirmed = 1
    ORDER BY i.position ASC
    LIMIT 200
  `);
  return rows.map((row) => ({
    placeId: String(row.place_id),
    position: num(row.position),
    note: typeof row.note === "string" ? row.note : null,
    name: String(row.name ?? ""),
    citySlug: String(row.city_slug ?? ""),
    streetAddress: String(row.street_address ?? ""),
    lat: typeof row.lat === "number" ? row.lat : null,
    lng: typeof row.lng === "number" ? row.lng : null,
  }));
}

export async function createList(
  userId: string,
  input: ValidatedList,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PlaceList> {
  const db = await client;
  const id = crypto.randomUUID();
  const now = Date.now();
  // Slugs are unique per user; a collision gets a short suffix rather than an error.
  const existing = await db.all<{ slug: string }>(sql`
    SELECT slug FROM place_lists WHERE user_id = ${userId} AND slug LIKE ${input.slug + "%"}
  `);
  const taken = new Set(existing.map((row) => row.slug));
  let slug = input.slug;
  for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${input.slug}-${suffix}`;

  await db.run(sql`
    INSERT INTO place_lists (
      id, user_id, title, slug, description, ranked, visibility, created_at, updated_at
    ) VALUES (
      ${id}, ${userId}, ${input.title}, ${slug}, ${input.description},
      ${input.ranked ? 1 : 0}, ${input.visibility}, ${now}, ${now}
    )
  `);
  return {
    id,
    userId,
    title: input.title,
    slug,
    description: input.description,
    ranked: input.ranked,
    visibility: input.visibility,
    itemCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateList(
  listId: string,
  userId: string,
  input: ValidatedList,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all<{ id: string }>(sql`
    UPDATE place_lists
    SET title = ${input.title}, description = ${input.description},
      ranked = ${input.ranked ? 1 : 0}, visibility = ${input.visibility},
      updated_at = ${Date.now()}
    WHERE id = ${listId} AND user_id = ${userId}
    RETURNING id
  `);
  return rows.length > 0;
}

export async function deleteList(
  listId: string,
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all<{ id: string }>(sql`
    DELETE FROM place_lists WHERE id = ${listId} AND user_id = ${userId} RETURNING id
  `);
  return rows.length > 0;
}

/** Replace the whole ordered set; positions come from array order. */
export async function replaceListItems(
  listId: string,
  items: ReadonlyArray<{ placeId: string; note: string | null }>,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<void> {
  const db = await client;
  const now = Date.now();

  // Only keep entries that point at a real, listed place. This used to be a
  // `WHERE EXISTS` guard inside each insert; resolving it up front keeps the
  // writes expressible as builders, which is what `db.batch()` needs.
  const valid = new Set<string>();
  if (items.length) {
    const rows = await db.all<{ id: string }>(sql`
      SELECT id FROM places
      WHERE halal_confirmed = 1
        AND id IN (${sql.join(items.map((item) => sql`${item.placeId}`), sql`, `)})
    `);
    for (const row of rows) valid.add(row.id);
  }

  // D1 rejects SQL `BEGIN`, so this is a batch rather than a transaction: the
  // delete and the re-inserts still land together or not at all, which matters
  // because a half-applied reorder would silently drop places from the list.
  await db.batch([
    db.delete(placeListItems).where(eq(placeListItems.listId, listId)),
    ...items
      .filter((item) => valid.has(item.placeId))
      .map((item, index) =>
        db.insert(placeListItems).values({
          listId,
          placeId: item.placeId,
          position: index + 1,
          note: item.note,
          createdAt: new Date(now),
        }),
      ),
    db
      .update(placeLists)
      .set({ updatedAt: new Date(now) })
      .where(eq(placeLists.id, listId)),
  ] as unknown as Parameters<typeof db.batch>[0]);
}

/** Public lists a viewer may open without signing in. */
export async function listPublicListsForUser(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PlaceList[]> {
  return listListsForUser(userId, { includePrivate: false }, client);
}
