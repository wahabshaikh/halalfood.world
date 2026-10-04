/**
 * D1 access for halal food events: iftar walks, Eid markets and food festivals.
 *
 * Moderators publish events. Every vendor carries its own status: a vendor
 * linked to a listed place shows that place's evidence-based status, and an
 * unlisted one shows "Unverified", which only means nobody has checked it here.
 * RSVPs are planning and never reach halal evidence.
 */

import { eq, sql } from "drizzle-orm";
import { database } from "../db";
import { eventVendors, events } from "../db/schema";
import {
  eventPhase,
  goingLine,
  vendorStatusView,
  type EventInput,
  type EventPhase,
  type VendorStatusView,
} from "@halalfood/core/events";
import { avatarUrl } from "@halalfood/core/social";
import { assessPlaces } from "./feed-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export type EventSummary = {
  id: string;
  title: string;
  citySlug: string;
  venue: string;
  startsAt: number;
  endsAt: number | null;
  cancelled: boolean;
  phase: EventPhase;
  vendorCount: number;
  going: number;
};

function mapSummary(row: Record<string, unknown>, now: number): EventSummary {
  const startsAt = num(row.starts_at);
  const endsAt = row.ends_at === null || row.ends_at === undefined ? null : num(row.ends_at);
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    citySlug: String(row.city_slug ?? ""),
    venue: String(row.venue ?? ""),
    startsAt,
    endsAt,
    cancelled: row.status === "cancelled",
    phase: eventPhase({ startsAt, endsAt }, now),
    vendorCount: num(row.vendor_count),
    going: num(row.going),
  };
}

const SUMMARY_COLUMNS = sql`
  e.id, e.title, e.city_slug, e.venue, e.starts_at, e.ends_at, e.status,
  (SELECT COUNT(*) FROM event_vendors AS v WHERE v.event_id = e.id) AS vendor_count,
  (SELECT COUNT(*) FROM event_rsvps AS r WHERE r.event_id = e.id) AS going
`;

/** An event that has no end time is treated as running six hours. */
const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * Events that have not finished yet, soonest first. Cancelled events are left
 * out of the listing and stay reachable by their own link.
 */
export async function listUpcomingEvents(
  options: { citySlug?: string | null; limit?: number; now?: number } = {},
  client: Client = database(),
): Promise<EventSummary[]> {
  const db = await client;
  const now = options.now ?? Date.now();
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20) || 20, 1), 50);
  const cityFilter = options.citySlug ? sql`AND e.city_slug = ${options.citySlug}` : sql``;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${SUMMARY_COLUMNS}
    FROM events AS e
    WHERE e.status = 'published'
      AND COALESCE(e.ends_at, e.starts_at + ${SIX_HOURS}) >= ${now}
      ${cityFilter}
    ORDER BY e.starts_at ASC, e.id ASC
    LIMIT ${limit}
  `);
  return rows.map((row) => mapSummary(row, now));
}

export type EventVendorView = {
  id: string;
  name: string;
  note: string | null;
  placeId: string | null;
  placeName: string | null;
  status: VendorStatusView;
};

export type EventDetail = EventSummary & {
  description: string | null;
  address: string | null;
  vendors: EventVendorView[];
};

/** One event with its vendors, each carrying its own status. Null when missing. */
export async function getEvent(
  eventId: string,
  client: Client = database(),
  now = Date.now(),
): Promise<EventDetail | null> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${SUMMARY_COLUMNS}, e.description, e.address
    FROM events AS e WHERE e.id = ${eventId} LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;

  const vendorRows = await db.all<Record<string, unknown>>(sql`
    SELECT v.id, v.name, v.note, v.place_id, p.name AS place_name
    FROM event_vendors AS v
    LEFT JOIN places AS p ON p.id = v.place_id AND p.halal_confirmed = 1 AND p.listing_status = 'listed'
    WHERE v.event_id = ${eventId}
    ORDER BY v.position ASC, v.name ASC
  `);
  const assessed = await assessPlaces(
    vendorRows
      .map((vendor) => (text(vendor.place_name) ? text(vendor.place_id) : null))
      .filter((id): id is string => id !== null),
    db,
  );
  const vendors: EventVendorView[] = vendorRows.map((vendor) => {
    const placeId = text(vendor.place_name) ? text(vendor.place_id) : null;
    const status = placeId ? assessed.get(placeId)?.status : undefined;
    return {
      id: String(vendor.id),
      name: String(vendor.name ?? ""),
      note: text(vendor.note),
      placeId,
      placeName: text(vendor.place_name),
      status: vendorStatusView(status),
    };
  });

  return {
    ...mapSummary(row, now),
    description: text(row.description),
    address: text(row.address),
    vendors,
  };
}

/* ---------------------------------------------------------------- rsvps -- */

export type GoingState = {
  going: number;
  viewerGoing: boolean;
  friends: { handle: string; displayName: string | null; avatarUrl: string | null }[];
  line: string | null;
};

/** How many are going, whether the viewer is, and which people they follow are. */
export async function getGoing(
  eventId: string,
  viewerId: string | null,
  client: Client = database(),
): Promise<GoingState> {
  const db = await client;
  const viewer = viewerId ?? "";
  const [counts, friendRows] = await Promise.all([
    db.all<Record<string, unknown>>(sql`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN user_id = ${viewer} THEN 1 ELSE 0 END) AS mine
      FROM event_rsvps WHERE event_id = ${eventId}
    `),
    viewerId
      ? db.all<Record<string, unknown>>(sql`
          SELECT p.handle, p.display_name, p.avatar_key
          FROM event_rsvps AS r
          INNER JOIN follows AS f
            ON f.followee_id = r.user_id AND f.follower_id = ${viewer} AND f.status = 'accepted'
          INNER JOIN user_profiles AS p ON p.user_id = r.user_id
          WHERE r.event_id = ${eventId}
            AND NOT EXISTS (
              SELECT 1 FROM user_blocks AS b
              WHERE (b.blocker_id = ${viewer} AND b.blocked_id = r.user_id)
                 OR (b.blocker_id = r.user_id AND b.blocked_id = ${viewer})
            )
          ORDER BY r.created_at DESC
          LIMIT 6
        `)
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);
  const going = num(counts[0]?.total);
  const friends = friendRows.map((row) => ({
    handle: String(row.handle),
    displayName: text(row.display_name),
    avatarUrl: avatarUrl(String(row.handle), text(row.avatar_key)),
  }));
  return {
    going,
    viewerGoing: num(counts[0]?.mine) > 0,
    friends,
    line: goingLine(friends, going),
  };
}

export type RsvpResult =
  | { ok: true; state: GoingState }
  | { ok: false; reason: "not-found" | "closed" };

/** "I'm going", or take it back. Cancelled and finished events take no new RSVPs. */
export async function setRsvp(
  eventId: string,
  userId: string,
  going: boolean,
  client: Client = database(),
  now = Date.now(),
): Promise<RsvpResult> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT status, starts_at, ends_at FROM events WHERE id = ${eventId} LIMIT 1
  `);
  const event = rows[0];
  if (!event) return { ok: false, reason: "not-found" };
  if (going) {
    const phase = eventPhase(
      {
        startsAt: num(event.starts_at),
        endsAt: event.ends_at === null || event.ends_at === undefined ? null : num(event.ends_at),
      },
      now,
    );
    if (event.status === "cancelled" || phase === "past") return { ok: false, reason: "closed" };
    await db.run(sql`
      INSERT INTO event_rsvps (event_id, user_id, created_at)
      VALUES (${eventId}, ${userId}, ${now})
      ON CONFLICT (event_id, user_id) DO NOTHING
    `);
  } else
    await db.run(sql`
      DELETE FROM event_rsvps WHERE event_id = ${eventId} AND user_id = ${userId}
    `);
  return { ok: true, state: await getGoing(eventId, userId, db) };
}

/* -------------------------------------------------------- moderation -- */

export type SaveEventResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unknown-place" | "not-found" };

async function unknownPlaces(placeIds: readonly string[], db: DatabaseClient): Promise<boolean> {
  const unique = [...new Set(placeIds)];
  if (!unique.length) return false;
  const rows = await db.all<{ total: unknown }>(sql`
    SELECT COUNT(*) AS total FROM places
    WHERE halal_confirmed = 1 AND listing_status = 'listed' AND id IN (${sql.join(
      unique.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return num(rows[0]?.total) !== unique.length;
}

function vendorRows(eventId: string, input: EventInput) {
  return input.vendors.map((vendor, index) => ({
    id: crypto.randomUUID(),
    eventId,
    name: vendor.name,
    note: vendor.note,
    placeId: vendor.placeId,
    position: index,
  }));
}

/** Publish an event with its vendors. Every linked place must be a listed place. */
export async function createEvent(
  input: EventInput,
  createdBy: string,
  client: Client = database(),
): Promise<SaveEventResult> {
  const db = await client;
  const placeIds = input.vendors.flatMap((vendor) => (vendor.placeId ? [vendor.placeId] : []));
  if (await unknownPlaces(placeIds, db)) return { ok: false, reason: "unknown-place" };

  const id = crypto.randomUUID();
  const now = Date.now();
  // D1 has no SQL transactions, so one batch keeps an event from existing
  // without its vendors.
  await db.batch([
    db.insert(events).values({
      id,
      title: input.title,
      description: input.description,
      citySlug: input.citySlug,
      venue: input.venue,
      address: input.address,
      startsAt: new Date(input.startsAt),
      endsAt: input.endsAt === null ? null : new Date(input.endsAt),
      status: "published",
      createdBy,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }),
    ...(input.vendors.length ? [db.insert(eventVendors).values(vendorRows(id, input))] : []),
  ] as unknown as Parameters<typeof db.batch>[0]);
  return { ok: true, id };
}

/** Replace an event's details and vendor list. RSVPs stay. */
export async function updateEvent(
  eventId: string,
  input: EventInput,
  client: Client = database(),
): Promise<SaveEventResult> {
  const db = await client;
  const existing = await db.all(sql`SELECT 1 FROM events WHERE id = ${eventId} LIMIT 1`);
  if (!existing.length) return { ok: false, reason: "not-found" };
  const placeIds = input.vendors.flatMap((vendor) => (vendor.placeId ? [vendor.placeId] : []));
  if (await unknownPlaces(placeIds, db)) return { ok: false, reason: "unknown-place" };

  await db.batch([
    db
      .update(events)
      .set({
        title: input.title,
        description: input.description,
        citySlug: input.citySlug,
        venue: input.venue,
        address: input.address,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt === null ? null : new Date(input.endsAt),
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId)),
    db.delete(eventVendors).where(eq(eventVendors.eventId, eventId)),
    ...(input.vendors.length ? [db.insert(eventVendors).values(vendorRows(eventId, input))] : []),
  ] as unknown as Parameters<typeof db.batch>[0]);
  return { ok: true, id: eventId };
}

/** Cancel an event, or bring it back. */
export async function setEventCancelled(
  eventId: string,
  cancelled: boolean,
  client: Client = database(),
): Promise<boolean> {
  const db = await client;
  const rows = await db.all(sql`
    UPDATE events SET status = ${cancelled ? "cancelled" : "published"}, updated_at = ${Date.now()}
    WHERE id = ${eventId}
    RETURNING id
  `);
  return rows.length > 0;
}
