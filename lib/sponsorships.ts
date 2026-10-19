/**
 * City sponsorships in D1: starting a checkout, applying Whop webhooks, the live card per city, and
 * moderation. The rules are in lib/core/sponsorship.ts; nothing here touches places or their status.
 */
import { sql } from "drizzle-orm";
import { database } from "@/lib/db";
import {
  cityAvailability,
  isLive,
  paidWindow,
  type CityAvailability,
  type SponsorInput,
  type SponsorStatus,
  type SponsorshipState,
  type WhopEvent,
} from "@/lib/core/sponsorship";
import { runBatch } from "./checks-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

type Row = Record<string, unknown>;

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function state(row: Row): SponsorshipState {
  return {
    id: String(row.id),
    userId: (row.user_id as string | null) ?? null,
    status: row.status as SponsorStatus,
    renews: Number(row.renews) === 1,
    startsAt: num(row.starts_at),
    activeUntil: num(row.active_until),
    createdAt: Number(row.created_at),
  };
}

export type SponsorCard = { id: string; citySlug: string; name: string; tagline: string | null; linkUrl: string };

function card(row: Row): SponsorCard {
  return {
    id: String(row.id),
    citySlug: String(row.city_slug),
    name: String(row.sponsor_name),
    tagline: (row.tagline as string | null) ?? null,
    linkUrl: String(row.link_url),
  };
}

/** Rows that can still hold a city: pending checkouts and paid sponsorships. */
async function holdingRows(db: DatabaseClient, citySlug: string): Promise<Row[]> {
  return db.all<Row>(sql`
    SELECT * FROM city_sponsorships
    WHERE city_slug = ${citySlug} AND status IN ('pending', 'active')
    ORDER BY created_at DESC
    LIMIT 50
  `);
}

/** The sponsor shown on a city's page right now, or null. */
export async function liveSponsor(citySlug: string, client: Client = database(), now = Date.now()): Promise<SponsorCard | null> {
  const db = await client;
  const rows = await db.all<Row>(sql`
    SELECT * FROM city_sponsorships
    WHERE city_slug = ${citySlug} AND status = 'active' AND starts_at <= ${now} AND active_until > ${now}
    ORDER BY starts_at ASC
    LIMIT 1
  `);
  return rows[0] ? card(rows[0]) : null;
}

/** Whether `viewerId` can buy the city now, and the current sponsor if there is one. */
export async function citySponsorship(
  citySlug: string,
  viewerId: string | null,
  client: Client = database(),
  now = Date.now(),
): Promise<{ availability: CityAvailability; sponsor: SponsorCard | null }> {
  const db = await client;
  const rows = await holdingRows(db, citySlug);
  const live = rows.find((row) => isLive(state(row), now));
  return { availability: cityAvailability(rows.map(state), now, viewerId), sponsor: live ? card(live) : null };
}

/** Every city with a live sponsor, for the sponsor directory. */
export async function liveSponsorsByCity(client: Client = database(), now = Date.now()): Promise<Map<string, SponsorCard & { activeUntil: number; renews: boolean }>> {
  const db = await client;
  const rows = await db.all<Row>(sql`
    SELECT * FROM city_sponsorships
    WHERE status = 'active' AND starts_at <= ${now} AND active_until > ${now}
    ORDER BY starts_at ASC
    LIMIT 2000
  `);
  const out = new Map<string, SponsorCard & { activeUntil: number; renews: boolean }>();
  for (const row of rows)
    if (!out.has(String(row.city_slug))) out.set(String(row.city_slug), { ...card(row), activeUntil: Number(row.active_until), renews: Number(row.renews) === 1 });
  return out;
}

type StartResult = { ok: true; id: string } | { ok: false; status: 409; error: string };

/** Record a pending sponsorship, which holds the city while its buyer is at checkout. */
export async function startSponsorship(userId: string, input: SponsorInput, client: Client = database(), now = Date.now()): Promise<StartResult> {
  const db = await client;
  const availability = cityAvailability((await holdingRows(db, input.citySlug)).map(state), now, userId);
  if (!availability.open)
    return {
      ok: false,
      status: 409,
      error: availability.reason === "sponsored" ? "This city already has a sponsor." : "Someone is checking out for this city. Try again in an hour.",
    };
  const id = crypto.randomUUID();
  await runBatch(db, [
    sql`INSERT INTO city_sponsorships (id, city_slug, user_id, sponsor_name, tagline, link_url, status, renews, created_at, updated_at)
        VALUES (${id}, ${input.citySlug}, ${userId}, ${input.name}, ${input.tagline}, ${input.linkUrl}, 'pending', 1, ${now}, ${now})`,
  ]);
  return { ok: true, id };
}

/** Remember the Whop checkout a pending sponsorship was sent to. */
export async function attachCheckout(id: string, checkoutId: string, client: Client = database(), now = Date.now()): Promise<void> {
  const db = await client;
  await runBatch(db, [
    sql`UPDATE city_sponsorships SET whop_checkout_id = ${checkoutId}, updated_at = ${now} WHERE id = ${id} AND status = 'pending'`,
  ]);
}

/** Drop a pending sponsorship whose checkout couldn't be created, so it doesn't hold the city. */
export async function discardPending(id: string, client: Client = database()): Promise<void> {
  const db = await client;
  await runBatch(db, [sql`DELETE FROM city_sponsorships WHERE id = ${id} AND status = 'pending'`]);
}

async function findForPayment(db: DatabaseClient, event: Extract<WhopEvent, { type: "payment.succeeded" }>): Promise<Row | null> {
  if (event.sponsorshipId) {
    const [row] = await db.all<Row>(sql`SELECT * FROM city_sponsorships WHERE id = ${event.sponsorshipId}`);
    if (row) return row;
  }
  if (event.checkoutId) {
    const [row] = await db.all<Row>(sql`SELECT * FROM city_sponsorships WHERE whop_checkout_id = ${event.checkoutId}`);
    if (row) return row;
  }
  if (event.membershipId) {
    const [row] = await db.all<Row>(sql`SELECT * FROM city_sponsorships WHERE whop_membership_id = ${event.membershipId} ORDER BY created_at DESC LIMIT 1`);
    if (row) return row;
  }
  return null;
}

export type WebhookOutcome = "duplicate" | "applied" | "unmatched" | "ignored";

/**
 * Apply one verified Whop webhook. A webhook id already seen is a no-op, so Whop's retries are safe.
 * Unknown sponsorships are recorded and ignored rather than failed: a retry wouldn't find them either.
 */
export async function applyWhopEvent(webhookId: string, event: WhopEvent, client: Client = database(), now = Date.now()): Promise<WebhookOutcome> {
  const db = await client;
  const [seen] = await db.all<{ id: string }>(sql`SELECT id FROM whop_webhook_events WHERE id = ${webhookId}`);
  if (seen) return "duplicate";
  const name = event.type === "ignored" ? event.name : event.type;
  const record = sql`INSERT OR IGNORE INTO whop_webhook_events (id, type, received_at) VALUES (${webhookId}, ${name.slice(0, 80)}, ${now})`;

  if (event.type === "payment.succeeded") {
    const row = await findForPayment(db, event);
    if (!row || row.status === "removed" || row.status === "refunded") {
      await runBatch(db, [record]);
      return "unmatched";
    }
    const others = (await holdingRows(db, String(row.city_slug))).map(state);
    const window = paidWindow(state(row), others, event.paidAt);
    await runBatch(db, [
      sql`UPDATE city_sponsorships SET status = 'active', renews = 1, starts_at = ${window.startsAt}, active_until = ${window.activeUntil},
          whop_payment_id = ${event.paymentId}, whop_membership_id = COALESCE(${event.membershipId}, whop_membership_id), updated_at = ${now}
          WHERE id = ${String(row.id)}`,
      record,
    ]);
    return "applied";
  }
  if (event.type === "membership.deactivated" || event.type === "membership.renewing") {
    await runBatch(db, [
      sql`UPDATE city_sponsorships SET renews = ${event.type === "membership.renewing" ? 1 : 0}, updated_at = ${now}
          WHERE status = 'active' AND (whop_membership_id = ${event.membershipId} OR (${event.sponsorshipId} IS NOT NULL AND id = ${event.sponsorshipId}))`,
      record,
    ]);
    return "applied";
  }
  if (event.type === "refund") {
    await runBatch(db, [
      sql`UPDATE city_sponsorships SET status = 'refunded', renews = 0, updated_at = ${now}
          WHERE status = 'active' AND ((${event.paymentId} IS NOT NULL AND whop_payment_id = ${event.paymentId})
            OR (${event.membershipId} IS NOT NULL AND whop_membership_id = ${event.membershipId}))`,
      record,
    ]);
    return "applied";
  }
  await runBatch(db, [record]);
  return "ignored";
}

export type MySponsorship = SponsorCard & { status: SponsorStatus; renews: boolean; startsAt: number | null; activeUntil: number | null; createdAt: number };

/** A buyer's own sponsorships, newest first. Abandoned checkouts older than a day are left out. */
export async function mySponsorships(userId: string, client: Client = database(), now = Date.now()): Promise<MySponsorship[]> {
  const db = await client;
  const rows = await db.all<Row>(sql`
    SELECT * FROM city_sponsorships
    WHERE user_id = ${userId} AND (status <> 'pending' OR created_at > ${now - 24 * 60 * 60 * 1000})
    ORDER BY created_at DESC
    LIMIT 50
  `);
  return rows.map((row) => ({ ...card(row), ...state(row), id: String(row.id) }));
}

export type AdminSponsorship = MySponsorship & { buyer: string | null; live: boolean };

/** Paid and moderated sponsorships for the moderation console, newest first. */
export async function listSponsorshipsForAdmin(client: Client = database(), now = Date.now()): Promise<AdminSponsorship[]> {
  const db = await client;
  const rows = await db.all<Row>(sql`
    SELECT s.*, p.handle FROM city_sponsorships s
    LEFT JOIN profiles p ON p.user_id = s.user_id
    WHERE s.status IN ('active', 'removed', 'refunded')
    ORDER BY s.created_at DESC
    LIMIT 200
  `);
  return rows.map((row) => ({
    ...card(row),
    ...state(row),
    id: String(row.id),
    buyer: (row.handle as string | null) ?? null,
    live: isLive(state(row), now),
  }));
}

/** Take a sponsor card down, or put it back. Audited. Billing stays in Whop: refund there if owed. */
export async function moderateSponsorship(
  id: string,
  moderatorId: string,
  action: "remove" | "restore",
  reason: string | null,
  client: Client = database(),
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  const db = await client;
  const [row] = await db.all<{ status: string }>(sql`SELECT status FROM city_sponsorships WHERE id = ${id}`);
  if (!row || row.status === "pending") return { ok: false, status: 404, error: "That sponsorship could not be found." };
  const from = action === "remove" ? "active" : "removed";
  const to = action === "remove" ? "removed" : "active";
  if (row.status !== from) return { ok: false, status: 409, error: action === "remove" ? "That sponsorship is not live." : "That sponsorship was not removed." };
  await runBatch(db, [
    sql`UPDATE city_sponsorships SET status = ${to}, updated_at = ${now} WHERE id = ${id} AND status = ${from}`,
    sql`INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, before_value, after_value, created_at)
        VALUES (${crypto.randomUUID()}, ${moderatorId}, ${`${action}-sponsorship`}, 'city_sponsorship', ${id}, ${reason},
          ${JSON.stringify({ status: from })}, ${JSON.stringify({ status: to })}, ${now})`,
  ]);
  return { ok: true };
}
