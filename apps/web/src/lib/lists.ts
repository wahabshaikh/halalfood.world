/**
 * Lists: ranked lists, plans with friends, and moderator guides (spec §5.3).
 */
import { sql, type SQL } from "drizzle-orm";
import { database } from "../db";
import { runBatch } from "./checks-repository";
import { notificationStatement } from "./notifications";
import { PLACE_CARD_COLUMNS, toPlaceCard, type PlaceCard } from "./place-view";

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

/* ------------------------------------------------------------------------ */
/* Validation                                                                */
/* ------------------------------------------------------------------------ */

export type ListFields = { title?: string; caption?: string | null; visibility?: ListVisibility; kind?: ListKind };

export function parseListFields(body: unknown, creating: boolean): { ok: true; fields: ListFields } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a JSON object." };
  const input = body as Record<string, unknown>;
  const fields: ListFields = {};
  if ("title" in input || creating) {
    const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
    if (!title) return { ok: false, error: "Give the list a name." };
    if (title.length > 80) return { ok: false, error: "Names are 80 characters or fewer." };
    fields.title = title;
  }
  if ("caption" in input) {
    if (input.caption !== null && typeof input.caption !== "string") return { ok: false, error: "Caption must be text." };
    const caption = typeof input.caption === "string" ? input.caption.replace(/\s+/g, " ").trim() : "";
    if (caption.length > 200) return { ok: false, error: "Captions are 200 characters or fewer." };
    fields.caption = caption || null;
  }
  if ("visibility" in input) {
    if (!LIST_VISIBILITIES.includes(input.visibility as ListVisibility)) return { ok: false, error: "Choose who can see it." };
    fields.visibility = input.visibility as ListVisibility;
  }
  if (creating) {
    if (!LIST_KINDS.includes(input.kind as ListKind)) return { ok: false, error: "Choose a kind of list." };
    fields.kind = input.kind as ListKind;
  }
  return { ok: true, fields };
}

export function cleanItemNote(value: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, note: null };
  if (typeof value !== "string") return { ok: false, error: "Notes must be text." };
  const note = value.replace(/\s+/g, " ").trim();
  if (note.length > 140) return { ok: false, error: "Notes are 140 characters or fewer." };
  return { ok: true, note: note || null };
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                   */
/* ------------------------------------------------------------------------ */

export type ListPerson = { userId: string; handle: string; name: string; avatarKey: string | null; status: "owner" | "invited" | "accepted" };

export type ListItem = PlaceCard & { position: number; note: string | null; been: boolean; addedByUserId: string | null };

export type ListDetail = ListSummary & {
  ownerId: string;
  caption: string | null;
  people: ListPerson[];
  places: ListItem[];
  been: number;
  role: "owner" | "member" | "invited" | "viewer";
  canAdd: boolean;
  savedByMe: boolean;
};

export async function getList(id: string, viewerId: string | null, client: Client = database()): Promise<ListDetail | null> {
  const db = await client;
  const [row] = await db.all<Record<string, unknown>>(sql`
    SELECT ${SUMMARY_COLUMNS}, l.owner_id, l.caption,
      ${viewerId ? sql`EXISTS (SELECT 1 FROM list_saves s WHERE s.list_id = l.id AND s.user_id = ${viewerId})` : sql`0`} AS saved_by_me,
      ${viewerId ? sql`(SELECT status FROM list_members m WHERE m.list_id = l.id AND m.user_id = ${viewerId})` : sql`NULL`} AS my_status
    FROM lists l LEFT JOIN profiles pr ON pr.user_id = l.owner_id
    WHERE l.id = ${id} AND COALESCE(pr.suspended_at, 0) = 0 AND ${visibleList(viewerId)}
  `);
  if (!row) return null;
  const summary = toListSummary(row);
  const ownerId = String(row.owner_id);
  const people = await db.all<Record<string, unknown>>(sql`
    SELECT pr.user_id, pr.handle, pr.display_name, pr.avatar_key, 'owner' AS status, 0 AS sort
    FROM profiles pr WHERE pr.user_id = ${ownerId}
    UNION ALL
    SELECT pr.user_id, pr.handle, pr.display_name, pr.avatar_key, m.status, 1 AS sort
    FROM list_members m JOIN profiles pr ON pr.user_id = m.user_id
    WHERE m.list_id = ${id} AND pr.suspended_at IS NULL
    ORDER BY sort
  `);
  const items = await db.all<Record<string, unknown>>(sql`
    SELECT ${PLACE_CARD_COLUMNS}, i.position, i.note AS item_note, i.added_by_user_id,
      ${viewerId ? sql`EXISTS (SELECT 1 FROM checks c WHERE c.place_id = p.id AND c.user_id = ${viewerId})` : sql`0`} AS been
    FROM list_items i JOIN places p ON p.id = i.place_id JOIN place_status s ON s.place_id = p.id
    WHERE i.list_id = ${id} AND p.listing_status <> 'hidden'
    ORDER BY i.position, i.created_at
  `);
  const myStatus = row.my_status as string | null;
  const role: ListDetail["role"] =
    viewerId === ownerId ? "owner" : myStatus === "accepted" ? "member" : myStatus === "invited" ? "invited" : "viewer";
  const listItems = items.map((item) => ({
    ...toPlaceCard(item),
    position: Number(item.position),
    note: (item.item_note as string | null) ?? null,
    been: Number(item.been) === 1,
    addedByUserId: (item.added_by_user_id as string | null) ?? null,
  }));
  return {
    ...summary,
    ownerId,
    caption: (row.caption as string | null) ?? null,
    people: people
      .filter((person) => summary.kind === "plan" || person.status === "owner")
      .map((person) => ({
        userId: String(person.user_id),
        handle: String(person.handle),
        name: String(person.display_name ?? person.handle),
        avatarKey: (person.avatar_key as string | null) ?? null,
        status: person.status as ListPerson["status"],
      })),
    places: listItems,
    been: listItems.filter((item) => item.been).length,
    role,
    canAdd: role === "owner" || (role === "member" && summary.kind === "plan"),
    savedByMe: Number(row.saved_by_me) === 1,
  };
}

/** The Saved tab's three groups. */
export async function myLists(viewerId: string, client: Client = database()) {
  const db = await client;
  const [own, planning, saved] = await Promise.all([
    listsOwnedBy(viewerId, viewerId, db),
    db.all<Record<string, unknown>>(sql`
      SELECT ${SUMMARY_COLUMNS}, m.status AS member_status
      FROM list_members m JOIN lists l ON l.id = m.list_id LEFT JOIN profiles pr ON pr.user_id = l.owner_id
      WHERE m.user_id = ${viewerId} AND pr.suspended_at IS NULL
      ORDER BY m.status = 'invited' DESC, l.updated_at DESC LIMIT 100
    `),
    db.all<Record<string, unknown>>(sql`
      SELECT ${SUMMARY_COLUMNS}
      FROM list_saves s JOIN lists l ON l.id = s.list_id LEFT JOIN profiles pr ON pr.user_id = l.owner_id
      WHERE s.user_id = ${viewerId} AND ${visibleList(viewerId)} AND COALESCE(pr.suspended_at, 0) = 0
      ORDER BY s.created_at DESC LIMIT 100
    `),
  ]);
  const people = async (listId: string) => {
    const [row] = await db.all<{ n: number }>(sql`SELECT count(*) + 1 AS n FROM list_members WHERE list_id = ${listId} AND status = 'accepted'`);
    return Number(row?.n ?? 1);
  };
  return {
    own: await Promise.all(own.map(async (list) => ({ ...list, people: list.kind === "plan" ? await people(list.id) : 1, invited: false }))),
    planning: await Promise.all(
      planning.map(async (row) => ({ ...toListSummary(row), people: await people(String(row.id)), invited: row.member_status === "invited" })),
    ),
    saved: saved.map((row) => ({ ...toListSummary(row), people: 1, invited: false })),
  };
}

/** Lists the viewer can add a place to: their own, plus plans they've joined. */
export async function listsICanAddTo(viewerId: string, placeId: string, client: Client = database()) {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${SUMMARY_COLUMNS},
      EXISTS (SELECT 1 FROM list_items i WHERE i.list_id = l.id AND i.place_id = ${placeId}) AS has_place
    FROM lists l LEFT JOIN profiles pr ON pr.user_id = l.owner_id
    WHERE l.owner_id = ${viewerId}
      OR (l.kind = 'plan' AND EXISTS (SELECT 1 FROM list_members m WHERE m.list_id = l.id AND m.user_id = ${viewerId} AND m.status = 'accepted'))
    ORDER BY l.updated_at DESC LIMIT 100
  `);
  return rows.map((row) => ({ ...toListSummary(row), hasPlace: Number(row.has_place) === 1 }));
}

/** Explore's "Guides & lists": the city's guides first, then the most-saved public lists with places there. */
export async function exploreLists(citySlug: string, client: Client = database()): Promise<ListSummary[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${SUMMARY_COLUMNS},
      (SELECT count(*) FROM list_saves s WHERE s.list_id = l.id) AS saves
    FROM lists l LEFT JOIN profiles pr ON pr.user_id = l.owner_id
    WHERE l.visibility = 'public' AND COALESCE(pr.suspended_at, 0) = 0
      AND (l.city_slug = ${citySlug} OR EXISTS (SELECT 1 FROM list_items i JOIN places p ON p.id = i.place_id WHERE i.list_id = l.id AND p.city_slug = ${citySlug}))
      AND EXISTS (SELECT 1 FROM list_items i WHERE i.list_id = l.id)
    ORDER BY l.kind = 'guide' DESC, saves DESC, l.updated_at DESC
    LIMIT 6
  `);
  return rows.map(toListSummary);
}

/* ------------------------------------------------------------------------ */
/* Writing                                                                   */
/* ------------------------------------------------------------------------ */

export type ListWrite<T = true> = { ok: true; value: T } | { ok: false; status: number; error: string };

const missing = { ok: false as const, status: 404, error: "That list could not be found." };
const notYours = { ok: false as const, status: 403, error: "Only the list’s owner can do that." };

async function ownerOf(db: DatabaseClient, listId: string) {
  const [row] = await db.all<{ owner_id: string; kind: ListKind }>(sql`SELECT owner_id, kind FROM lists WHERE id = ${listId}`);
  return row ?? null;
}

async function cityOf(db: DatabaseClient, placeId: string) {
  const [row] = await db.all<{ city_slug: string }>(sql`SELECT city_slug FROM places WHERE id = ${placeId} AND listing_status = 'listed'`);
  return row?.city_slug ?? null;
}

async function hasChecked(db: DatabaseClient, userId: string, placeId: string) {
  // check-visibility: owner-only — whether the owner has their own check here.
  const rows = await db.all(sql`SELECT 1 FROM checks WHERE user_id = ${userId} AND place_id = ${placeId} LIMIT 1`);
  return rows.length > 0;
}

export async function createList(
  ownerId: string,
  fields: Required<Pick<ListFields, "title" | "kind">> & ListFields,
  options: { moderator: boolean; placeId?: string | null },
  client: Client = database(),
  now = Date.now(),
): Promise<ListWrite<string>> {
  const db = await client;
  if (fields.kind === "guide" && !options.moderator) return { ok: false, status: 403, error: "Only moderators can make guides." };
  let visibility = fields.visibility;
  if (!visibility) {
    const [profile] = await db.all<{ lists_private_default: number }>(sql`SELECT lists_private_default FROM profiles WHERE user_id = ${ownerId}`);
    visibility = Number(profile?.lists_private_default) === 1 ? "private" : "public";
  }
  const city = options.placeId ? await cityOf(db, options.placeId) : null;
  if (options.placeId && !city) return { ok: false, status: 404, error: "That place could not be found." };
  if (options.placeId && fields.kind === "ranked" && !(await hasChecked(db, ownerId, options.placeId)))
    return { ok: false, status: 422, error: "Check a place before you rank it." };
  const id = crypto.randomUUID();
  await runBatch(db, [
    sql`INSERT INTO lists (id, owner_id, kind, title, caption, visibility, city_slug, created_at, updated_at)
        VALUES (${id}, ${ownerId}, ${fields.kind}, ${fields.title}, ${fields.caption ?? null}, ${visibility}, ${city}, ${now}, ${now})`,
    ...(options.placeId
      ? [sql`INSERT INTO list_items (list_id, place_id, position, added_by_user_id, created_at) VALUES (${id}, ${options.placeId}, 0, ${ownerId}, ${now})`]
      : []),
  ]);
  return { ok: true, value: id };
}

export async function updateList(listId: string, viewerId: string, fields: ListFields, client: Client = database(), now = Date.now()): Promise<ListWrite> {
  const db = await client;
  const list = await ownerOf(db, listId);
  if (!list) return missing;
  if (list.owner_id !== viewerId) return notYours;
  const sets: SQL[] = [sql`updated_at = ${now}`];
  if (fields.title !== undefined) sets.push(sql`title = ${fields.title}`);
  if (fields.caption !== undefined) sets.push(sql`caption = ${fields.caption}`);
  if (fields.visibility !== undefined) sets.push(sql`visibility = ${fields.visibility}`);
  await db.run(sql`UPDATE lists SET ${sql.join(sets, sql`, `)} WHERE id = ${listId}`);
  return { ok: true, value: true };
}

export async function deleteList(listId: string, viewerId: string, moderator: boolean, client: Client = database()): Promise<ListWrite> {
  const db = await client;
  const list = await ownerOf(db, listId);
  if (!list) return missing;
  if (list.owner_id !== viewerId && !moderator) return notYours;
  await db.run(sql`DELETE FROM lists WHERE id = ${listId}`);
  return { ok: true, value: true };
}

async function canAddTo(db: DatabaseClient, listId: string, viewerId: string) {
  const list = await ownerOf(db, listId);
  if (!list) return { list: null, allowed: false };
  if (list.owner_id === viewerId) return { list, allowed: true };
  if (list.kind !== "plan") return { list, allowed: false };
  const [member] = await db.all(sql`SELECT 1 FROM list_members WHERE list_id = ${listId} AND user_id = ${viewerId} AND status = 'accepted'`);
  return { list, allowed: Boolean(member) };
}

export async function addItem(listId: string, viewerId: string, placeId: string, note: string | null, client: Client = database(), now = Date.now()): Promise<ListWrite> {
  const db = await client;
  const { list, allowed } = await canAddTo(db, listId, viewerId);
  if (!list) return missing;
  if (!allowed) return { ok: false, status: 403, error: "You can’t add to this list." };
  const city = await cityOf(db, placeId);
  if (!city) return { ok: false, status: 404, error: "That place could not be found." };
  if (list.kind === "ranked" && !(await hasChecked(db, list.owner_id, placeId)))
    return { ok: false, status: 422, error: "Check a place before you rank it." };
  await runBatch(db, [
    sql`INSERT INTO list_items (list_id, place_id, position, note, added_by_user_id, created_at)
        VALUES (${listId}, ${placeId}, (SELECT COALESCE(MAX(position), -1) + 1 FROM list_items WHERE list_id = ${listId}), ${note}, ${viewerId}, ${now})
        ON CONFLICT (list_id, place_id) DO UPDATE SET note = COALESCE(excluded.note, list_items.note)`,
    sql`UPDATE lists SET updated_at = ${now}, city_slug = COALESCE(city_slug, ${city}) WHERE id = ${listId}`,
  ]);
  return { ok: true, value: true };
}

export async function removeItem(listId: string, viewerId: string, placeId: string, client: Client = database(), now = Date.now()): Promise<ListWrite> {
  const db = await client;
  const list = await ownerOf(db, listId);
  if (!list) return missing;
  const [item] = await db.all<{ added_by_user_id: string | null }>(sql`SELECT added_by_user_id FROM list_items WHERE list_id = ${listId} AND place_id = ${placeId}`);
  if (!item) return { ok: true, value: true };
  if (list.owner_id !== viewerId && item.added_by_user_id !== viewerId) return { ok: false, status: 403, error: "Only the owner or whoever added it can remove it." };
  await runBatch(db, [
    sql`DELETE FROM list_items WHERE list_id = ${listId} AND place_id = ${placeId}`,
    sql`UPDATE lists SET updated_at = ${now} WHERE id = ${listId}`,
  ]);
  return { ok: true, value: true };
}

/** Replace the order. Every current item must be named exactly once. */
export async function reorderItems(listId: string, viewerId: string, placeIds: string[], client: Client = database(), now = Date.now()): Promise<ListWrite> {
  const db = await client;
  const list = await ownerOf(db, listId);
  if (!list) return missing;
  if (list.owner_id !== viewerId) return notYours;
  const current = await db.all<{ place_id: string }>(sql`SELECT place_id FROM list_items WHERE list_id = ${listId}`);
  const have = new Set(current.map((row) => row.place_id));
  if (placeIds.length !== have.size || new Set(placeIds).size !== placeIds.length || placeIds.some((id) => !have.has(id)))
    return { ok: false, status: 400, error: "Send every place on the list once." };
  if (list.kind === "ranked")
    for (const placeId of placeIds)
      if (!(await hasChecked(db, viewerId, placeId))) return { ok: false, status: 422, error: "Check every place before you rank it." };
  await runBatch(db, [
    ...placeIds.map((placeId, position) => sql`UPDATE list_items SET position = ${position} WHERE list_id = ${listId} AND place_id = ${placeId}`),
    sql`UPDATE lists SET updated_at = ${now} WHERE id = ${listId}`,
  ]);
  return { ok: true, value: true };
}

export async function setListSaved(listId: string, viewerId: string, on: boolean, client: Client = database(), now = Date.now()): Promise<ListWrite> {
  const db = await client;
  const [visible] = await db.all<{ owner_id: string }>(sql`SELECT l.owner_id FROM lists l WHERE l.id = ${listId} AND ${visibleList(viewerId)}`);
  if (!visible) return missing;
  if (visible.owner_id === viewerId) return { ok: false, status: 400, error: "That’s your own list." };
  await db.run(
    on
      ? sql`INSERT INTO list_saves (list_id, user_id, created_at) VALUES (${listId}, ${viewerId}, ${now}) ON CONFLICT DO NOTHING`
      : sql`DELETE FROM list_saves WHERE list_id = ${listId} AND user_id = ${viewerId}`,
  );
  return { ok: true, value: true };
}

/** Invite people to a plan. Only the owner invites; blocks are skipped silently. */
export async function inviteMembers(listId: string, viewerId: string, handles: string[], client: Client = database(), now = Date.now()): Promise<ListWrite<number>> {
  const db = await client;
  const list = await ownerOf(db, listId);
  if (!list) return missing;
  if (list.owner_id !== viewerId) return notYours;
  if (list.kind !== "plan") return { ok: false, status: 400, error: "Only plans have members." };
  const statements: SQL[] = [];
  let invited = 0;
  for (const handle of handles.slice(0, 10)) {
    const [person] = await db.all<{ user_id: string }>(sql`
      SELECT pr.user_id FROM profiles pr
      WHERE lower(pr.handle) = lower(${handle}) AND pr.suspended_at IS NULL AND pr.user_id <> ${viewerId}
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = pr.user_id) OR (b.blocker_id = pr.user_id AND b.blocked_id = ${viewerId}))
    `);
    if (!person) continue;
    invited += 1;
    statements.push(sql`INSERT INTO list_members (list_id, user_id, status, invited_by, created_at)
      VALUES (${listId}, ${person.user_id}, 'invited', ${viewerId}, ${now}) ON CONFLICT DO NOTHING`);
    const note = notificationStatement(
      { userId: person.user_id, kind: "list-invite", actorId: viewerId, listId, dedupeKey: `list-invite:${listId}` },
      now,
    );
    if (note) statements.push(note);
  }
  if (statements.length) await runBatch(db, statements);
  return { ok: true, value: invited };
}

export async function acceptInvite(listId: string, viewerId: string, client: Client = database()): Promise<ListWrite> {
  const db = await client;
  const [row] = await db.all(sql`SELECT 1 FROM list_members WHERE list_id = ${listId} AND user_id = ${viewerId}`);
  if (!row) return missing;
  await db.run(sql`UPDATE list_members SET status = 'accepted' WHERE list_id = ${listId} AND user_id = ${viewerId}`);
  return { ok: true, value: true };
}

/** Leave a plan yourself, or (as the owner) remove someone. */
export async function removeMember(listId: string, viewerId: string, handle: string, client: Client = database()): Promise<ListWrite> {
  const db = await client;
  const list = await ownerOf(db, listId);
  if (!list) return missing;
  const [person] = await db.all<{ user_id: string }>(sql`SELECT user_id FROM profiles WHERE lower(handle) = lower(${handle})`);
  if (!person) return missing;
  if (person.user_id !== viewerId && list.owner_id !== viewerId) return notYours;
  await db.run(sql`DELETE FROM list_members WHERE list_id = ${listId} AND user_id = ${person.user_id}`);
  return { ok: true, value: true };
}
