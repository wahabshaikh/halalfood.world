/**
 * Halal food events: iftar walks, Eid markets and food festivals (spec §5.4,
 * §6.23). Moderators publish them. Each stall shows its linked place's status,
 * or "Not checked yet" when it has no place. RSVPs never touch halal status.
 */
import { sql, type SQL } from "drizzle-orm";
import { parseStatus, type PlaceStatus } from "@/lib/core/halal";
import { database } from "@/lib/db";
import { runBatch } from "./checks-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

/** An event without an end time is treated as running six hours. */
export const SIX_HOURS = 6 * 60 * 60 * 1000;

export type FriendGoing = { userId: string; handle: string; name: string; avatarKey: string | null };

export type EventSummary = {
  id: string;
  title: string;
  citySlug: string;
  venue: string;
  address: string | null;
  startsAt: number;
  endsAt: number | null;
  status: "draft" | "published" | "cancelled";
  stalls: number;
  verifiedStalls: number;
  going: number;
  goingByMe: boolean;
  friends: FriendGoing[];
};

export type Stall = { id: string; name: string; note: string | null; placeId: string | null; placeName: string | null; status: PlaceStatus };

export type EventDetail = EventSummary & { description: string | null; stallList: Stall[] };

function summaryColumns(viewerId: string | null): SQL {
  return sql`
    e.id, e.title, e.city_slug, e.venue, e.address, e.starts_at, e.ends_at, e.status, e.description,
    (SELECT count(*) FROM event_vendors v WHERE v.event_id = e.id) AS stalls,
    (SELECT count(*) FROM event_vendors v JOIN place_status s ON s.place_id = v.place_id JOIN places p ON p.id = v.place_id
      WHERE v.event_id = e.id AND s.status = 'verified' AND p.listing_status = 'listed') AS verified_stalls,
    (SELECT count(*) FROM event_rsvps r WHERE r.event_id = e.id) AS going,
    ${viewerId ? sql`EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = ${viewerId})` : sql`0`} AS going_by_me
  `;
}

function toSummary(row: Record<string, unknown>): EventSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    citySlug: String(row.city_slug),
    venue: String(row.venue),
    address: (row.address as string | null) ?? null,
    startsAt: Number(row.starts_at),
    endsAt: row.ends_at === null || row.ends_at === undefined ? null : Number(row.ends_at),
    status: row.status as EventSummary["status"],
    stalls: Number(row.stalls ?? 0),
    verifiedStalls: Number(row.verified_stalls ?? 0),
    going: Number(row.going ?? 0),
    goingByMe: Number(row.going_by_me) === 1,
    friends: [],
  };
}

/** Followees going to each event (plus the viewer), for the friends-going line. */
async function friendsGoing(db: DatabaseClient, eventIds: string[], viewerId: string | null): Promise<Map<string, FriendGoing[]>> {
  const out = new Map<string, FriendGoing[]>();
  if (!viewerId || !eventIds.length) return out;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT r.event_id, pr.user_id, pr.handle, pr.display_name, pr.avatar_key
    FROM event_rsvps r JOIN profiles pr ON pr.user_id = r.user_id
    WHERE r.event_id IN (${sql.join(eventIds.map((id) => sql`${id}`), sql`, `)}) AND pr.suspended_at IS NULL
      AND (r.user_id = ${viewerId} OR r.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId} AND status = 'accepted'))
    ORDER BY r.user_id = ${viewerId} DESC, r.created_at DESC
  `);
  for (const row of rows) {
    const list = out.get(String(row.event_id)) ?? [];
    list.push({ userId: String(row.user_id), handle: String(row.handle), name: String(row.display_name ?? row.handle), avatarKey: (row.avatar_key as string | null) ?? null });
    out.set(String(row.event_id), list);
  }
  return out;
}

/** Upcoming published events, soonest first. `withinDays` narrows to the next n days. */
export async function listEvents(
  options: { citySlug?: string | null; viewerId?: string | null; limit?: number; withinDays?: number; now?: number },
  client: Client = database(),
): Promise<EventSummary[]> {
  const db = await client;
  const now = options.now ?? Date.now();
  const viewerId = options.viewerId ?? null;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${summaryColumns(viewerId)}
    FROM events e
    WHERE e.status = 'published' AND COALESCE(e.ends_at, e.starts_at + ${SIX_HOURS}) >= ${now}
      ${options.citySlug ? sql`AND e.city_slug = ${options.citySlug}` : sql``}
      ${options.withinDays ? sql`AND e.starts_at <= ${now + options.withinDays * 24 * 60 * 60 * 1000}` : sql``}
    ORDER BY e.starts_at ASC, e.id
    LIMIT ${Math.min(Math.max(options.limit ?? 30, 1), 100)}
  `);
  const events = rows.map(toSummary);
  const friends = await friendsGoing(db, events.map((event) => event.id), viewerId);
  return events.map((event) => ({ ...event, friends: friends.get(event.id) ?? [] }));
}

/** One event with its stalls. Drafts only show to moderators. */
export async function getEvent(id: string, viewerId: string | null, options: { moderator?: boolean } = {}, client: Client = database()): Promise<EventDetail | null> {
  const db = await client;
  const [row] = await db.all<Record<string, unknown>>(sql`SELECT ${summaryColumns(viewerId)} FROM events e WHERE e.id = ${id}`);
  if (!row || (row.status === "draft" && !options.moderator)) return null;
  const stalls = await db.all<Record<string, unknown>>(sql`
    SELECT v.id, v.name, v.note, v.place_id, p.name AS place_name, s.status, s.progress
    FROM event_vendors v
    LEFT JOIN places p ON p.id = v.place_id AND p.listing_status = 'listed'
    LEFT JOIN place_status s ON s.place_id = p.id
    WHERE v.event_id = ${id}
    ORDER BY v.position, v.name
  `);
  const friends = await friendsGoing(db, [id], viewerId);
  return {
    ...toSummary(row),
    friends: friends.get(id) ?? [],
    description: (row.description as string | null) ?? null,
    stallList: stalls.map(
      (stall): Stall => ({
        id: String(stall.id),
        name: String(stall.name),
        note: (stall.note as string | null) ?? null,
        placeId: stall.place_name ? String(stall.place_id) : null,
        placeName: (stall.place_name as string | null) ?? null,
        status: stall.place_name ? parseStatus(stall.status, stall.progress) : { kind: "unchecked" },
      }),
    ),
  };
}

export async function setGoing(eventId: string, viewerId: string, on: boolean, client: Client = database(), now = Date.now()) {
  const db = await client;
  const [event] = await db.all(sql`SELECT 1 FROM events WHERE id = ${eventId} AND status = 'published'`);
  if (!event) return null;
  await db.run(
    on
      ? sql`INSERT INTO event_rsvps (event_id, user_id, created_at) VALUES (${eventId}, ${viewerId}, ${now}) ON CONFLICT DO NOTHING`
      : sql`DELETE FROM event_rsvps WHERE event_id = ${eventId} AND user_id = ${viewerId}`,
  );
  const [count] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM event_rsvps WHERE event_id = ${eventId}`);
  return { going: on, count: Number(count?.n ?? 0) };
}

/* ------------------------------------------------------------------------ */
/* Moderation                                                                */
/* ------------------------------------------------------------------------ */

export type EventInput = {
  title: string;
  description: string | null;
  citySlug: string;
  venue: string;
  address: string | null;
  startsAt: number;
  endsAt: number | null;
  status: "draft" | "published" | "cancelled";
  stalls: { name: string; note: string | null; placeId: string | null }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export function parseEventInput(body: unknown): { ok: true; value: EventInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a JSON object." };
  const input = body as Record<string, unknown>;
  const title = text(input.title, 120);
  const venue = text(input.venue, 160);
  const citySlug = typeof input.citySlug === "string" && /^[a-z0-9-]{1,120}$/.test(input.citySlug) ? input.citySlug : null;
  const startsAt = Number(input.startsAt);
  const endsAt = input.endsAt === null || input.endsAt === undefined || input.endsAt === "" ? null : Number(input.endsAt);
  const status = input.status === "published" || input.status === "cancelled" ? input.status : "draft";
  if (!title) return { ok: false, error: "Give the event a title." };
  if (!venue) return { ok: false, error: "Add a venue." };
  if (!citySlug) return { ok: false, error: "Choose a city." };
  if (!Number.isFinite(startsAt) || startsAt <= 0) return { ok: false, error: "Add a start time." };
  if (endsAt !== null && (!Number.isFinite(endsAt) || endsAt < startsAt)) return { ok: false, error: "The end must be after the start." };
  const rawStalls = Array.isArray(input.stalls) ? input.stalls.slice(0, 100) : [];
  const stalls: EventInput["stalls"] = [];
  for (const raw of rawStalls) {
    const stall = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const name = text(stall.name, 120);
    if (!name) continue;
    const placeId = typeof stall.placeId === "string" && UUID.test(stall.placeId) ? stall.placeId.toLowerCase() : null;
    stalls.push({ name, note: text(stall.note, 200), placeId });
  }
  return {
    ok: true,
    value: { title, description: text(input.description, 2000), citySlug, venue, address: text(input.address, 300), startsAt, endsAt, status, stalls },
  };
}

/** Create (no id) or replace an event and its stalls. */
export async function saveEvent(id: string | null, input: EventInput, moderatorId: string, client: Client = database(), now = Date.now()): Promise<string | null> {
  const db = await client;
  const eventId = id ?? crypto.randomUUID();
  if (id) {
    const [existing] = await db.all(sql`SELECT 1 FROM events WHERE id = ${id}`);
    if (!existing) return null;
  }
  await runBatch(db, [
    id
      ? sql`UPDATE events SET title = ${input.title}, description = ${input.description}, city_slug = ${input.citySlug}, venue = ${input.venue},
          address = ${input.address}, starts_at = ${input.startsAt}, ends_at = ${input.endsAt}, status = ${input.status}, updated_at = ${now}
          WHERE id = ${id}`
      : sql`INSERT INTO events (id, title, description, city_slug, venue, address, starts_at, ends_at, status, created_by, created_at, updated_at)
          VALUES (${eventId}, ${input.title}, ${input.description}, ${input.citySlug}, ${input.venue}, ${input.address}, ${input.startsAt},
            ${input.endsAt}, ${input.status}, ${moderatorId}, ${now}, ${now})`,
    sql`DELETE FROM event_vendors WHERE event_id = ${eventId}`,
    ...input.stalls.map(
      (stall, position) => sql`INSERT INTO event_vendors (id, event_id, name, note, place_id, position)
        VALUES (${crypto.randomUUID()}, ${eventId}, ${stall.name}, ${stall.note},
          (SELECT id FROM places WHERE id = ${stall.placeId}), ${position})`,
    ),
  ]);
  return eventId;
}

export async function deleteEvent(id: string, client: Client = database()) {
  const db = await client;
  await db.run(sql`DELETE FROM events WHERE id = ${id}`);
}

/** Every event for the moderation tab, newest first. */
export async function listAllEvents(client: Client = database()) {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`SELECT ${summaryColumns(null)} FROM events e ORDER BY e.starts_at DESC LIMIT 200`);
  return rows.map(toSummary);
}
