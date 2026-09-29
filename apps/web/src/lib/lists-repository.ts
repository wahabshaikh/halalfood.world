/**
 * D1 access for lists: the owner's own lists and items, plus the social layer
 * on top of them (collaborators, saves, an edit link, and finding other
 * people's lists).
 *
 * Who may see a list is decided here, in one place: the owner, accepted
 * collaborators and invited diners always can; everyone else needs the list to
 * be public or unlisted, and to have no block with the owner, and, for a private
 * account, to be one of its accepted followers. Nothing here reads or writes
 * halal evidence: a list, a save or a collaborator is taste, never a status.
 */

import { eq, sql } from "drizzle-orm";
import { database } from "../db";
import { listCollaborators, placeListItems, placeLists } from "../db/schema";
import {
  MAX_COLLABORATORS,
  MAX_LIST_ITEMS,
  canEditItems,
  type ListRole,
  type ListStanding,
  type PlaceList,
  type ValidatedList,
} from "@halalfood/core/place-lists";
import { avatarUrl } from "@halalfood/core/social";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number(value ?? 0) || 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function mapList(row: Record<string, unknown>): PlaceList {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title ?? ""),
    slug: String(row.slug ?? ""),
    description: text(row.description),
    caption: text(row.caption),
    coverPlaceId: text(row.cover_place_id),
    displayCoverPlaceId: text(row.display_cover_id),
    ranked: row.ranked === 1 || row.ranked === true,
    visibility:
      row.visibility === "private"
        ? "private"
        : row.visibility === "unlisted"
          ? "unlisted"
          : "public",
    itemCount: num(row.item_count),
    saveCount: num(row.save_count),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

const LIST_SELECT = sql`
  SELECT l.*,
    (SELECT COUNT(*) FROM place_list_items AS i WHERE i.list_id = l.id) AS item_count,
    (SELECT COUNT(*) FROM list_saves AS s WHERE s.list_id = l.id) AS save_count,
    COALESCE(l.cover_place_id, (
      SELECT i.place_id FROM place_list_items AS i
      WHERE i.list_id = l.id ORDER BY i.position LIMIT 1
    )) AS display_cover_id
  FROM place_lists AS l
`;

export async function listListsForUser(
  userId: string,
  options: { includePrivate: boolean },
  client: Client = database(),
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
  client: Client = database(),
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
  /** The diner who put it on the list, so a shared list shows whose pick it is. */
  addedByHandle: string | null;
  addedByUserId: string | null;
};

export async function listItems(
  listId: string,
  client: Client = database(),
): Promise<ListPlace[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT i.place_id, i.position, i.note, i.added_by_user_id, p.name, p.city_slug,
      p.street_address, p.lat, p.lng, pr.handle AS added_by_handle
    FROM place_list_items AS i
    INNER JOIN places AS p ON p.id = i.place_id
    LEFT JOIN user_profiles AS pr ON pr.user_id = i.added_by_user_id
    WHERE i.list_id = ${listId} AND p.halal_confirmed = 1
    ORDER BY i.position ASC
    LIMIT ${MAX_LIST_ITEMS}
  `);
  return rows.map((row) => ({
    placeId: String(row.place_id),
    position: num(row.position),
    note: text(row.note),
    name: String(row.name ?? ""),
    citySlug: String(row.city_slug ?? ""),
    streetAddress: String(row.street_address ?? ""),
    lat: typeof row.lat === "number" ? row.lat : null,
    lng: typeof row.lng === "number" ? row.lng : null,
    addedByHandle: text(row.added_by_handle),
    addedByUserId: text(row.added_by_user_id),
  }));
}

export async function createList(
  userId: string,
  input: ValidatedList,
  client: Client = database(),
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

  // A brand new list has no places yet, so it cannot have a cover.
  await db.run(sql`
    INSERT INTO place_lists (
      id, user_id, title, slug, description, caption, ranked, visibility, created_at, updated_at
    ) VALUES (
      ${id}, ${userId}, ${input.title}, ${slug}, ${input.description}, ${input.caption},
      ${input.ranked ? 1 : 0}, ${input.visibility}, ${now}, ${now}
    )
  `);
  return {
    id,
    userId,
    title: input.title,
    slug,
    description: input.description,
    caption: input.caption,
    coverPlaceId: null,
    displayCoverPlaceId: null,
    ranked: input.ranked,
    visibility: input.visibility,
    itemCount: 0,
    saveCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateList(
  listId: string,
  userId: string,
  input: ValidatedList,
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all<{ id: string }>(sql`
    UPDATE place_lists
    SET title = ${input.title}, description = ${input.description},
      caption = ${input.caption}, cover_place_id = ${input.coverPlaceId},
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
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all<{ id: string }>(sql`
    DELETE FROM place_lists WHERE id = ${listId} AND user_id = ${userId} RETURNING id
  `);
  return rows.length > 0;
}

/** Is this place on the list? Used to check a cover choice. */
export async function listHasPlace(
  listId: string,
  placeId: string,
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all(sql`
    SELECT 1 FROM place_list_items WHERE list_id = ${listId} AND place_id = ${placeId} LIMIT 1
  `);
  return rows.length > 0;
}

/** Replace the whole ordered set; positions come from array order. */
export async function replaceListItems(
  listId: string,
  items: ReadonlyArray<{ placeId: string; note: string | null }>,
  client: Client = database(),
  actorId: string | null = null,
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

  // Keep who added each place across a reorder: the whole set is rewritten, so
  // the previous attribution is read first and carried over.
  const previous = await db.all<{ place_id: string; added_by_user_id: string | null }>(sql`
    SELECT place_id, added_by_user_id FROM place_list_items WHERE list_id = ${listId}
  `);
  const addedBy = new Map(previous.map((row) => [row.place_id, row.added_by_user_id] as const));

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
          addedByUserId: addedBy.get(item.placeId) ?? actorId,
          createdAt: new Date(now),
        }),
      ),
    db
      .update(placeLists)
      .set({ updatedAt: new Date(now) })
      .where(eq(placeLists.id, listId)),
  ] as unknown as Parameters<typeof db.batch>[0]);
}

export type AddItemResult = "added" | "exists" | "full" | "not-found";

/** Add one place to the end of a list. The caller has already checked the role. */
export async function addListItem(
  listId: string,
  placeId: string,
  note: string | null,
  actorId: string,
  client: Client = database(),
): Promise<AddItemResult> {
  const db = await client;
  const place = await db.all(sql`
    SELECT 1 FROM places WHERE id = ${placeId} AND halal_confirmed = 1 LIMIT 1
  `);
  if (!place.length) return "not-found";
  const stats = (
    await db.all<Record<string, unknown>>(sql`
      SELECT COUNT(*) AS total, COALESCE(MAX(position), 0) AS last,
        SUM(CASE WHEN place_id = ${placeId} THEN 1 ELSE 0 END) AS present
      FROM place_list_items WHERE list_id = ${listId}
    `)
  )[0];
  if (num(stats?.present) > 0) return "exists";
  if (num(stats?.total) >= MAX_LIST_ITEMS) return "full";
  const now = Date.now();
  await db.batch([
    db.insert(placeListItems).values({
      listId,
      placeId,
      position: num(stats?.last) + 1,
      note,
      addedByUserId: actorId,
      createdAt: new Date(now),
    }),
    db.update(placeLists).set({ updatedAt: new Date(now) }).where(eq(placeLists.id, listId)),
  ] as unknown as Parameters<typeof db.batch>[0]);
  return "added";
}

/**
 * Take a place off a list, or change its note. The owner can touch any row; an
 * editor only the ones they added.
 */
export async function changeListItem(
  listId: string,
  placeId: string,
  actor: { userId: string; role: ListRole },
  change: { remove: true } | { note: string | null },
  client: Client = database(),
): Promise<boolean> {
  if (!canEditItems(actor.role)) return false;
  const db = await client;
  const own = actor.role === "owner" ? sql`1 = 1` : sql`added_by_user_id = ${actor.userId}`;
  const rows =
    "remove" in change
      ? await db.all<{ place_id: string }>(sql`
          DELETE FROM place_list_items
          WHERE list_id = ${listId} AND place_id = ${placeId} AND ${own}
          RETURNING place_id
        `)
      : await db.all<{ place_id: string }>(sql`
          UPDATE place_list_items SET note = ${change.note}
          WHERE list_id = ${listId} AND place_id = ${placeId} AND ${own}
          RETURNING place_id
        `);
  if (!rows.length) return false;
  await db.run(sql`UPDATE place_lists SET updated_at = ${Date.now()} WHERE id = ${listId}`);
  // A removed place cannot stay the cover.
  if ("remove" in change)
    await db.run(sql`
      UPDATE place_lists SET cover_place_id = NULL
      WHERE id = ${listId} AND cover_place_id = ${placeId}
    `);
  return true;
}

/** Public lists a viewer may open without signing in. */
export async function listPublicListsForUser(
  userId: string,
  client: Client = database(),
): Promise<PlaceList[]> {
  return listListsForUser(userId, { includePrivate: false }, client);
}

/* ------------------------------------------------------------- access -- */

export type ListPerson = {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

function mapPerson(row: Record<string, unknown>): ListPerson {
  const handle = String(row.handle ?? "");
  return {
    userId: String(row.user_id),
    handle,
    displayName: text(row.display_name),
    avatarUrl: avatarUrl(handle, text(row.avatar_key)),
  };
}

export type ListAccess = {
  list: PlaceList;
  owner: ListPerson | null;
  /** How this viewer stands to the list. "invited" may open it and answer the invite. */
  role: ListStanding;
  saved: boolean;
  /** Whether the edit link is on. Only ever true for the owner's own view. */
  editLinkOn: boolean;
};

/**
 * The list as one viewer may see it, or null when they may not: private lists
 * belong to their people, a block hides the list both ways, and a private
 * account's lists open only for its accepted followers.
 */
export async function getListForViewer(
  listId: string,
  viewerId: string | null,
  client: Client = database(),
): Promise<ListAccess | null> {
  const db = await client;
  const list = await getList(listId, db);
  if (!list) return null;
  const viewer = viewerId ?? "";

  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      (SELECT status FROM list_collaborators WHERE list_id = ${listId} AND user_id = ${viewer}) AS collab,
      EXISTS (
        SELECT 1 FROM user_blocks AS b
        WHERE (b.blocker_id = ${viewer} AND b.blocked_id = ${list.userId})
           OR (b.blocker_id = ${list.userId} AND b.blocked_id = ${viewer})
      ) AS blocked,
      EXISTS (
        SELECT 1 FROM follows AS f
        WHERE f.follower_id = ${viewer} AND f.followee_id = ${list.userId} AND f.status = 'accepted'
      ) AS follows_owner,
      EXISTS (
        SELECT 1 FROM list_saves WHERE list_id = ${listId} AND user_id = ${viewer}
      ) AS saved,
      pr.is_private AS owner_private, pr.user_id, pr.handle, pr.display_name, pr.avatar_key
    FROM (SELECT 1) AS one
    LEFT JOIN user_profiles AS pr ON pr.user_id = ${list.userId}
  `);
  const row = rows[0] ?? {};
  const isOwner = viewerId !== null && viewerId === list.userId;
  const collab = row.collab === "accepted" ? "editor" : row.collab === "invited" ? "invited" : null;
  const role: ListStanding = isOwner ? "owner" : (collab ?? "viewer");
  const truthy = (value: unknown) => value === 1 || value === true;

  if (role === "viewer") {
    if (list.visibility === "private") return null;
    if (truthy(row.blocked)) return null;
    if (truthy(row.owner_private) && !truthy(row.follows_owner)) return null;
  } else if (role !== "owner" && truthy(row.blocked)) return null;

  let editLinkOn = false;
  if (isOwner) {
    const token = await db.all<{ edit_token: string | null }>(sql`
      SELECT edit_token FROM place_lists WHERE id = ${listId}
    `);
    editLinkOn = Boolean(token[0]?.edit_token);
  }
  return {
    list,
    owner: row.user_id ? mapPerson(row) : null,
    role,
    saved: truthy(row.saved),
    editLinkOn,
  };
}

/* ------------------------------------------------------- collaborators -- */

export type Collaborator = ListPerson & { status: "invited" | "accepted" };

export async function listCollaboratorsOf(
  listId: string,
  client: Client = database(),
): Promise<Collaborator[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT c.status, pr.user_id, pr.handle, pr.display_name, pr.avatar_key
    FROM list_collaborators AS c
    INNER JOIN user_profiles AS pr ON pr.user_id = c.user_id
    WHERE c.list_id = ${listId}
    ORDER BY c.created_at
    LIMIT ${MAX_COLLABORATORS + 5}
  `);
  return rows.map((row) => ({
    ...mapPerson(row),
    status: row.status === "accepted" ? "accepted" : "invited",
  }));
}

export type InviteResult =
  | { ok: true; person: ListPerson }
  | { ok: false; reason: "not-found" | "self" | "full" | "exists" };

/** Invite a diner by handle. Someone with a block either way looks like a missing account. */
export async function inviteCollaborator(
  listId: string,
  ownerId: string,
  handle: string,
  client: Client = database(),
): Promise<InviteResult> {
  const db = await client;
  const target = (
    await db.all<Record<string, unknown>>(sql`
      SELECT p.user_id, p.handle, p.display_name, p.avatar_key
      FROM user_profiles AS p
      WHERE p.handle = ${handle} AND p.onboarded_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks AS b
          WHERE (b.blocker_id = ${ownerId} AND b.blocked_id = p.user_id)
             OR (b.blocker_id = p.user_id AND b.blocked_id = ${ownerId})
        )
      LIMIT 1
    `)
  )[0];
  if (!target) return { ok: false, reason: "not-found" };
  const person = mapPerson(target);
  if (person.userId === ownerId) return { ok: false, reason: "self" };

  const stats = (
    await db.all<Record<string, unknown>>(sql`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN user_id = ${person.userId} THEN 1 ELSE 0 END) AS present
      FROM list_collaborators WHERE list_id = ${listId}
    `)
  )[0];
  if (num(stats?.present) > 0) return { ok: false, reason: "exists" };
  if (num(stats?.total) >= MAX_COLLABORATORS) return { ok: false, reason: "full" };

  const now = Date.now();
  await db.insert(listCollaborators).values({
    listId,
    userId: person.userId,
    status: "invited",
    invitedBy: ownerId,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  return { ok: true, person };
}

/** The invited diner answers. Declining removes the row, so they can be asked again. */
export async function respondToListInvite(
  listId: string,
  userId: string,
  accept: boolean,
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  if (accept) {
    const rows = await db.all(sql`
      UPDATE list_collaborators SET status = 'accepted', updated_at = ${Date.now()}
      WHERE list_id = ${listId} AND user_id = ${userId} AND status = 'invited'
      RETURNING user_id
    `);
    return rows.length > 0;
  }
  const rows = await db.all(sql`
    DELETE FROM list_collaborators
    WHERE list_id = ${listId} AND user_id = ${userId} AND status = 'invited'
    RETURNING user_id
  `);
  return rows.length > 0;
}

/** The owner removes someone, or a collaborator leaves. */
export async function removeCollaborator(
  listId: string,
  userId: string,
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all(sql`
    DELETE FROM list_collaborators WHERE list_id = ${listId} AND user_id = ${userId}
    RETURNING user_id
  `);
  return rows.length > 0;
}

/* ---------------------------------------------------------- edit link -- */

function newEditToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Turn the edit link on (returning its token) or off. A new token replaces the old one. */
export async function setEditLink(
  listId: string,
  ownerId: string,
  enabled: boolean,
  client: Client = database(),
): Promise<string | null> {
  const db = await client;
  const token = enabled ? newEditToken() : null;
  const rows = await db.all(sql`
    UPDATE place_lists SET edit_token = ${token} WHERE id = ${listId} AND user_id = ${ownerId}
    RETURNING id
  `);
  return rows.length ? token : null;
}

export async function getEditToken(
  listId: string,
  ownerId: string,
  client: Client = database(),
): Promise<string | null> {
  const db = await client;
  const rows = await db.all<{ edit_token: string | null }>(sql`
    SELECT edit_token FROM place_lists WHERE id = ${listId} AND user_id = ${ownerId}
  `);
  return rows[0]?.edit_token ?? null;
}

export type JoinResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "full" | "owner" };

/** Anyone signed in with a valid link becomes a collaborator, unless blocked by the owner. */
export async function joinListWithToken(
  listId: string,
  userId: string,
  token: string,
  client: Client = database(),
): Promise<JoinResult> {
  const db = await client;
  const list = (
    await db.all<Record<string, unknown>>(sql`
      SELECT user_id, edit_token, ranked FROM place_lists WHERE id = ${listId}
    `)
  )[0];
  if (!list || !list.edit_token || list.edit_token !== token) return { ok: false, reason: "invalid" };
  if (list.user_id === userId) return { ok: false, reason: "owner" };
  if (list.ranked === 1 || list.ranked === true) return { ok: false, reason: "invalid" };
  const blocked = await db.all(sql`
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = ${userId} AND blocked_id = ${String(list.user_id)})
       OR (blocker_id = ${String(list.user_id)} AND blocked_id = ${userId})
    LIMIT 1
  `);
  if (blocked.length) return { ok: false, reason: "invalid" };

  const stats = (
    await db.all<Record<string, unknown>>(sql`
      SELECT COUNT(*) AS total FROM list_collaborators WHERE list_id = ${listId}
    `)
  )[0];
  const now = Date.now();
  const existing = await db.all(sql`
    SELECT 1 FROM list_collaborators WHERE list_id = ${listId} AND user_id = ${userId}
  `);
  if (!existing.length && num(stats?.total) >= MAX_COLLABORATORS) return { ok: false, reason: "full" };
  await db.run(sql`
    INSERT INTO list_collaborators (list_id, user_id, status, invited_by, created_at, updated_at)
    VALUES (${listId}, ${userId}, 'accepted', ${String(list.user_id)}, ${now}, ${now})
    ON CONFLICT(list_id, user_id) DO UPDATE SET status = 'accepted', updated_at = ${now}
  `);
  return { ok: true };
}

export async function hasCollaborators(
  listId: string,
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all(sql`
    SELECT 1 FROM list_collaborators WHERE list_id = ${listId} LIMIT 1
  `);
  return rows.length > 0;
}

/* -------------------------------------------------------------- saves -- */

export type SaveResult = { ok: true } | { ok: false; reason: "own" | "not-found" };

/** Save someone else's list. Your own is already yours; a list you cannot see is not found. */
export async function saveList(
  listId: string,
  userId: string,
  client: Client = database(),
): Promise<SaveResult> {
  const db = await client;
  const access = await getListForViewer(listId, userId, db);
  if (!access) return { ok: false, reason: "not-found" };
  if (access.role === "owner") return { ok: false, reason: "own" };
  await db.run(sql`
    INSERT INTO list_saves (list_id, user_id, created_at)
    VALUES (${listId}, ${userId}, ${Date.now()})
    ON CONFLICT(list_id, user_id) DO NOTHING
  `);
  return { ok: true };
}

export async function unsaveList(
  listId: string,
  userId: string,
  client: Client = database(),
): Promise<void> {
  const db = await client;
  await db.run(sql`DELETE FROM list_saves WHERE list_id = ${listId} AND user_id = ${userId}`);
}

/* -------------------------------------------------------- list cards -- */

export type ListCard = PlaceList & {
  owner: { handle: string; displayName: string | null };
  coverPlaceName: string | null;
};

function mapCard(row: Record<string, unknown>): ListCard {
  return {
    ...mapList(row),
    owner: { handle: String(row.owner_handle ?? ""), displayName: text(row.owner_name) },
    coverPlaceName: text(row.cover_name),
  };
}

const CARD_SELECT = sql`
  SELECT l.*,
    (SELECT COUNT(*) FROM place_list_items AS i WHERE i.list_id = l.id) AS item_count,
    (SELECT COUNT(*) FROM list_saves AS s WHERE s.list_id = l.id) AS save_count,
    COALESCE(l.cover_place_id, (
      SELECT i.place_id FROM place_list_items AS i
      WHERE i.list_id = l.id ORDER BY i.position LIMIT 1
    )) AS display_cover_id,
    pr.handle AS owner_handle, pr.display_name AS owner_name,
    (SELECT cp.name FROM places AS cp WHERE cp.id = COALESCE(l.cover_place_id, (
      SELECT i.place_id FROM place_list_items AS i
      WHERE i.list_id = l.id ORDER BY i.position LIMIT 1
    ))) AS cover_name
  FROM place_lists AS l
  INNER JOIN user_profiles AS pr ON pr.user_id = l.user_id
`;

export type ListHub = {
  mine: ListCard[];
  collaborating: ListCard[];
  invites: ListCard[];
  saved: ListCard[];
};

/** Everything on the lists page: yours, ones you edit with others, invites and saves. */
export async function listHub(userId: string, client: Client = database()): Promise<ListHub> {
  const db = await client;
  const [mine, shared, saved] = await Promise.all([
    db.all<Record<string, unknown>>(sql`
      ${CARD_SELECT} WHERE l.user_id = ${userId} ORDER BY l.updated_at DESC LIMIT 200
    `),
    db.all<Record<string, unknown>>(sql`
      ${CARD_SELECT}
      INNER JOIN list_collaborators AS c ON c.list_id = l.id AND c.user_id = ${userId}
      ORDER BY l.updated_at DESC LIMIT 100
    `),
    db.all<Record<string, unknown>>(sql`
      ${CARD_SELECT}
      INNER JOIN list_saves AS sv ON sv.list_id = l.id AND sv.user_id = ${userId}
      WHERE l.visibility <> 'private'
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks AS b
          WHERE (b.blocker_id = ${userId} AND b.blocked_id = l.user_id)
             OR (b.blocker_id = l.user_id AND b.blocked_id = ${userId})
        )
      ORDER BY sv.created_at DESC LIMIT 100
    `),
  ]);
  const status = await db.all<{ list_id: string; status: string }>(sql`
    SELECT list_id, status FROM list_collaborators WHERE user_id = ${userId}
  `);
  const invited = new Set(status.filter((row) => row.status === "invited").map((row) => row.list_id));
  const shared_ = shared.map(mapCard);
  return {
    mine: mine.map(mapCard),
    collaborating: shared_.filter((card) => !invited.has(card.id)),
    invites: shared_.filter((card) => invited.has(card.id)),
    saved: saved.map(mapCard),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Public lists, most saved first. Lists are left out when their owner keeps
 * lists private, when the owner's account is private and the viewer is not an
 * accepted follower, when either side has blocked the other, and when empty.
 */
export async function searchLists(
  query: string,
  viewerId: string | null,
  limit = 20,
  client: Client = database(),
): Promise<ListCard[]> {
  const db = await client;
  const term = query.trim().toLowerCase();
  const viewer = viewerId ?? "";
  const match = term
    ? (() => {
        const like = `%${escapeLike(term)}%`;
        return sql`AND (
          LOWER(l.title) LIKE ${like} ESCAPE '\\'
          OR LOWER(COALESCE(l.caption, '')) LIKE ${like} ESCAPE '\\'
          OR LOWER(COALESCE(l.description, '')) LIKE ${like} ESCAPE '\\'
          OR pr.handle LIKE ${like} ESCAPE '\\'
        )`;
      })()
    : sql``;
  const rows = await db.all<Record<string, unknown>>(sql`
    ${CARD_SELECT}
    LEFT JOIN user_preferences AS up ON up.user_id = l.user_id
    WHERE l.visibility = 'public'
      AND COALESCE(up.visibility_lists, 'public') = 'public'
      AND EXISTS (SELECT 1 FROM place_list_items AS x WHERE x.list_id = l.id)
      AND (
        l.user_id = ${viewer}
        OR (
          (COALESCE(pr.is_private, 0) = 0 OR EXISTS (
            SELECT 1 FROM follows AS f
            WHERE f.follower_id = ${viewer} AND f.followee_id = l.user_id AND f.status = 'accepted'
          ))
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks AS b
            WHERE (b.blocker_id = ${viewer} AND b.blocked_id = l.user_id)
               OR (b.blocker_id = l.user_id AND b.blocked_id = ${viewer})
          )
        )
      )
      ${match}
    ORDER BY save_count DESC, l.updated_at DESC
    LIMIT ${Math.min(Math.max(Math.trunc(limit) || 20, 1), 50)}
  `);
  return rows.map(mapCard);
}

/** The viewer's own public handle, for answering an invite or leaving a list. */
export async function handleOf(userId: string, client: Client = database()): Promise<string | null> {
  const db = await client;
  const rows = await db.all<{ handle: string | null }>(sql`
    SELECT handle FROM user_profiles WHERE user_id = ${userId} LIMIT 1
  `);
  return rows[0]?.handle ?? null;
}
