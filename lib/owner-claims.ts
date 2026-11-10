/**
 * Restaurant claims in D1: checkout, Whop payments, hours, menu, photos, view counts and moderation.
 * Rules live in lib/core/owner-claim.ts. Nothing here writes place_status or calls the halal engine.
 */
import { sql } from "drizzle-orm";
import { database } from "@/lib/db";
import {
  CLAIM_HOLD_MS,
  CLAIM_RENEWAL_GRACE_MS,
  FEATURED_PER_CITY,
  claimHoldUntil,
  claimPaidWindow,
  fillViewDays,
  isPaidLive,
  isPublicClaim,
  moderateClaimTransition,
  readOwnerHours,
  utcDay,
  type ClaimCheckoutInput,
  type ClaimReview,
  type ClaimRole,
  type ClaimState,
  type ClaimStatus,
  type DayHours,
  type ModerateClaimAction,
  type OwnerClaimEvent,
  type OwnerDetailsInput,
  type OwnerMenuItemInput,
  type ViewDay,
} from "@/lib/core/owner-claim";
import { runBatch } from "./checks-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;
type Row = Record<string, unknown>;

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function state(row: Row): ClaimState {
  return {
    id: String(row.id),
    userId: (row.user_id as string | null) ?? null,
    status: row.status as ClaimStatus,
    review: row.review_status as ClaimReview,
    renews: Number(row.renews) === 1,
    startsAt: num(row.starts_at),
    activeUntil: num(row.active_until),
    createdAt: Number(row.created_at),
  };
}

export type OwnerMenuItem = OwnerMenuItemInput & { position: number };

export type OwnerDetails = OwnerDetailsInput;

export type PublicOwnerPlace = {
  badge: boolean;
  hours: DayHours[] | null;
  hoursNote: string | null;
  menu: OwnerMenuItem[];
  /** Phone, website and description once a moderator has approved the claim. */
  details: OwnerDetails | null;
};

export type FeaturedPlace = {
  claimId: string;
  placeId: string;
  name: string;
  streetAddress: string;
};

export type OwnerClaimRecord = {
  id: string;
  placeId: string;
  placeName: string;
  citySlug: string;
  userId: string | null;
  role: ClaimRole;
  contactEmail: string;
  status: ClaimStatus;
  review: ClaimReview;
  renews: boolean;
  startsAt: number | null;
  activeUntil: number | null;
  createdAt: number;
  paidLive: boolean;
  public: boolean;
  hours: DayHours[] | null;
  hoursNote: string | null;
  menu: OwnerMenuItem[];
  details: OwnerDetails | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

function fail(status: number, error: string): Result<never> {
  return { ok: false, status, error };
}

async function placeRow(db: DatabaseClient, placeId: string): Promise<Row | null> {
  const [row] = await db.all<Row>(sql`
    SELECT id, name, city_slug, listing_status FROM places WHERE id = ${placeId}
  `);
  return row ?? null;
}

async function openRows(db: DatabaseClient, placeId: string): Promise<Row[]> {
  return db.all<Row>(sql`
    SELECT * FROM owner_claims
    WHERE place_id = ${placeId} AND status IN ('pending', 'active')
    ORDER BY created_at DESC
    LIMIT 5
  `);
}

/** Drop expired checkouts and paid windows so the restaurant can be claimed again. */
async function releaseExpired(db: DatabaseClient, placeId: string, now: number): Promise<void> {
  await runBatch(db, [
    sql`DELETE FROM owner_claims
        WHERE place_id = ${placeId} AND status = 'pending' AND created_at <= ${now - CLAIM_HOLD_MS}`,
    sql`UPDATE owner_claims
        SET status = 'ended', renews = 0, updated_at = ${now}
        WHERE place_id = ${placeId} AND status = 'active' AND active_until IS NOT NULL
          AND active_until + CASE WHEN renews = 1 THEN ${CLAIM_RENEWAL_GRACE_MS} ELSE 0 END <= ${now}`,
  ]);
}

export type StartedClaim = { id: string; created: boolean };

/** Record a pending claim, or reuse the buyer's own checkout while it still holds the restaurant. */
export async function startOwnerClaim(
  userId: string,
  input: ClaimCheckoutInput,
  client: Client = database(),
  now = Date.now(),
): Promise<Result<StartedClaim>> {
  const db = await client;
  const place = await placeRow(db, input.placeId);
  if (!place || place.listing_status !== "listed") return fail(404, "That restaurant could not be found.");
  await releaseExpired(db, input.placeId, now);
  const rows = await openRows(db, input.placeId);
  for (const row of rows) {
    const current = state(row);
    if (claimHoldUntil(current, now) === null) continue;
    if (current.userId === userId && current.status === "pending") {
      await runBatch(db, [
        sql`UPDATE owner_claims SET role = ${input.role}, contact_email = ${input.contactEmail}, updated_at = ${now}
            WHERE id = ${current.id} AND status = 'pending'`,
      ]);
      return { ok: true, value: { id: current.id, created: false } };
    }
    return fail(
      409,
      current.status === "active" ? "This restaurant already has a claim." : "Someone is checking out for this restaurant. Try again in an hour.",
    );
  }
  const id = crypto.randomUUID();
  try {
    await runBatch(db, [
      sql`INSERT INTO owner_claims (id, place_id, user_id, role, contact_email, status, review_status, renews, created_at, updated_at)
          VALUES (${id}, ${input.placeId}, ${userId}, ${input.role}, ${input.contactEmail}, 'pending', 'pending', 1, ${now}, ${now})`,
    ]);
  } catch {
    return fail(409, "Someone else just started a claim for this restaurant.");
  }
  return { ok: true, value: { id, created: true } };
}

export async function attachClaimCheckout(id: string, checkoutId: string, client: Client = database(), now = Date.now()): Promise<void> {
  const db = await client;
  await runBatch(db, [
    sql`UPDATE owner_claims SET whop_checkout_id = ${checkoutId}, updated_at = ${now} WHERE id = ${id} AND status = 'pending'`,
  ]);
}

/** Drop a pending claim whose checkout could not be opened, so it does not hold the restaurant. */
export async function discardPendingClaim(id: string, client: Client = database()): Promise<void> {
  const db = await client;
  await runBatch(db, [sql`DELETE FROM owner_claims WHERE id = ${id} AND status = 'pending'`]);
}

async function claimById(db: DatabaseClient, id: string): Promise<Row | null> {
  const [row] = await db.all<Row>(sql`SELECT * FROM owner_claims WHERE id = ${id}`);
  return row ?? null;
}

function menuItems(rows: Row[]): OwnerMenuItem[] {
  return rows.map((row) => ({
    position: Number(row.position),
    section: (row.section as string | null) ?? null,
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    currency: String(row.currency),
  }));
}

async function hoursFor(db: DatabaseClient, placeId: string): Promise<{ week: DayHours[] | null; note: string | null }> {
  const [row] = await db.all<Row>(sql`SELECT week_json, note FROM owner_hours WHERE place_id = ${placeId}`);
  if (!row) return { week: null, note: null };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(String(row.week_json));
  } catch {
    parsed = null;
  }
  return { week: readOwnerHours(parsed), note: (row.note as string | null) ?? null };
}

const EMPTY_DETAILS: OwnerDetails = { phone: null, website: null, description: null };

async function detailsFor(db: DatabaseClient, placeId: string): Promise<OwnerDetails | null> {
  const [row] = await db.all<Row>(sql`SELECT phone, website, description FROM owner_place_details WHERE place_id = ${placeId}`);
  if (!row) return null;
  return {
    phone: (row.phone as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    description: (row.description as string | null) ?? null,
  };
}

async function menuFor(db: DatabaseClient, placeId: string): Promise<OwnerMenuItem[]> {
  const rows = await db.all<Row>(sql`
    SELECT position, section, name, description, price, currency
    FROM owner_menu_items WHERE place_id = ${placeId} ORDER BY position ASC LIMIT 80
  `);
  return menuItems(rows);
}

/** Public hours, menu and badge. Empty when the claim is unpaid or still awaiting a moderator. */
export async function publicOwnerPlace(placeId: string, client: Client = database(), now = Date.now()): Promise<PublicOwnerPlace> {
  const db = await client;
  const rows = await openRows(db, placeId);
  const live = rows.map(state).find((row) => isPublicClaim(row, now));
  if (!live) return { badge: false, hours: null, hoursNote: null, menu: [], details: null };
  const [hours, menu, details] = await Promise.all([hoursFor(db, placeId), menuFor(db, placeId), detailsFor(db, placeId)]);
  return { badge: true, hours: hours.week, hoursNote: hours.note, menu, details };
}

/** Whether the signed-in person holds the open claim, so the place page can link to it. */
export async function viewerOwnsOpenClaim(placeId: string, userId: string | null, client: Client = database(), now = Date.now()): Promise<boolean> {
  if (!userId) return false;
  const db = await client;
  const rows = await openRows(db, placeId);
  return rows.some((row) => {
    const current = state(row);
    return current.userId === userId && claimHoldUntil(current, now) !== null;
  });
}

/** Sponsored restaurants for a city page, approved and paid, capped, never mixed into ranking. */
export async function featuredPlaces(citySlug: string, client: Client = database(), now = Date.now()): Promise<FeaturedPlace[]> {
  const db = await client;
  const rows = await db.all<Row>(sql`
    SELECT c.id AS claim_id, p.id AS place_id, p.name, p.street_address
    FROM owner_claims c
    JOIN places p ON p.id = c.place_id
    WHERE p.city_slug = ${citySlug}
      AND p.listing_status = 'listed'
      AND c.status = 'active'
      AND c.review_status = 'approved'
      AND c.starts_at <= ${now}
      AND c.active_until > ${now}
    ORDER BY c.reviewed_at ASC
    LIMIT ${FEATURED_PER_CITY}
  `);
  return rows.map((row) => ({
    claimId: String(row.claim_id),
    placeId: String(row.place_id),
    name: String(row.name),
    streetAddress: String(row.street_address),
  }));
}

async function ownedClaim(db: DatabaseClient, claimId: string, userId: string, now: number): Promise<Result<Row>> {
  const row = await claimById(db, claimId);
  if (!row || row.user_id !== userId) return fail(404, "That claim could not be found.");
  if (!isPaidLive(state(row), now)) return fail(403, "Renew the claim before editing this restaurant.");
  return { ok: true, value: row };
}

/** The buyer's claim for one restaurant, including drafts that are not public yet. */
export async function ownerClaimForViewer(
  placeId: string,
  userId: string,
  client: Client = database(),
  now = Date.now(),
): Promise<OwnerClaimRecord | null> {
  const db = await client;
  const [row] = await db.all<Row>(sql`
    SELECT c.*, p.name AS place_name, p.city_slug
    FROM owner_claims c JOIN places p ON p.id = c.place_id
    WHERE c.place_id = ${placeId} AND c.user_id = ${userId} AND c.status IN ('pending', 'active', 'removed')
    ORDER BY c.created_at DESC
    LIMIT 1
  `);
  if (!row) return null;
  const current = state(row);
  const [hours, menu, details] = await Promise.all([hoursFor(db, placeId), menuFor(db, placeId), detailsFor(db, placeId)]);
  return {
    id: current.id,
    placeId,
    placeName: String(row.place_name),
    citySlug: String(row.city_slug),
    userId: current.userId,
    role: row.role === "manager" ? "manager" : "owner",
    contactEmail: String(row.contact_email),
    status: current.status,
    review: current.review,
    renews: current.renews,
    startsAt: current.startsAt,
    activeUntil: current.activeUntil,
    createdAt: current.createdAt,
    paidLive: isPaidLive(current, now),
    public: isPublicClaim(current, now),
    hours: hours.week,
    hoursNote: hours.note,
    menu,
    details: details ?? EMPTY_DETAILS,
  };
}

/**
 * Phone, website and description. The paid claim has to belong to this account,
 * and the account has to have claimed as the owner (a manager cannot).
 * The public page still waits for a moderator.
 */
export async function saveOwnerDetails(
  claimId: string,
  userId: string,
  details: OwnerDetails,
  client: Client = database(),
  now = Date.now(),
): Promise<Result<{ ok: true }>> {
  const db = await client;
  const owned = await ownedClaim(db, claimId, userId, now);
  if (!owned.ok) return owned;
  if (owned.value.role !== "owner") return fail(403, "Only the restaurant's owner can edit the phone, website and description.");
  const placeId = String(owned.value.place_id);
  await runBatch(db, [
    sql`INSERT INTO owner_place_details (place_id, claim_id, phone, website, description, updated_at)
        VALUES (${placeId}, ${claimId}, ${details.phone}, ${details.website}, ${details.description}, ${now})
        ON CONFLICT(place_id) DO UPDATE SET
          claim_id = excluded.claim_id, phone = excluded.phone, website = excluded.website,
          description = excluded.description, updated_at = excluded.updated_at`,
  ]);
  return { ok: true, value: { ok: true } };
}

export async function saveOwnerHours(
  claimId: string,
  userId: string,
  week: DayHours[],
  note: string | null,
  client: Client = database(),
  now = Date.now(),
): Promise<Result<{ ok: true }>> {
  const db = await client;
  const owned = await ownedClaim(db, claimId, userId, now);
  if (!owned.ok) return owned;
  const placeId = String(owned.value.place_id);
  await runBatch(db, [
    sql`INSERT INTO owner_hours (place_id, claim_id, week_json, note, updated_at)
        VALUES (${placeId}, ${claimId}, ${JSON.stringify(week)}, ${note}, ${now})
        ON CONFLICT(place_id) DO UPDATE SET
          claim_id = excluded.claim_id, week_json = excluded.week_json, note = excluded.note, updated_at = excluded.updated_at`,
  ]);
  return { ok: true, value: { ok: true } };
}

export async function saveOwnerMenu(
  claimId: string,
  userId: string,
  items: OwnerMenuItemInput[],
  client: Client = database(),
  now = Date.now(),
): Promise<Result<{ count: number }>> {
  const db = await client;
  const owned = await ownedClaim(db, claimId, userId, now);
  if (!owned.ok) return owned;
  const placeId = String(owned.value.place_id);
  const statements = [sql`DELETE FROM owner_menu_items WHERE place_id = ${placeId}`];
  items.forEach((item, position) => {
    statements.push(sql`
      INSERT INTO owner_menu_items (id, place_id, claim_id, position, section, name, description, price, currency)
      VALUES (${crypto.randomUUID()}, ${placeId}, ${claimId}, ${position}, ${item.section}, ${item.name},
        ${item.description}, ${item.price}, ${item.currency})
    `);
  });
  await runBatch(db, statements);
  return { ok: true, value: { count: items.length } };
}

/** A photo the restaurant added. It does not become evidence unless the caller also files a certificate. */
export async function insertRestaurantPhoto(
  claimId: string,
  userId: string,
  photo: { r2Key: string; contentType: string; byteSize: number },
  client: Client = database(),
  now = Date.now(),
): Promise<Result<{ photoId: string }>> {
  const db = await client;
  const owned = await ownedClaim(db, claimId, userId, now);
  if (!owned.ok) return owned;
  const placeId = String(owned.value.place_id);
  const photoId = crypto.randomUUID();
  await runBatch(db, [
    sql`INSERT INTO place_photos (id, place_id, user_id, r2_key, content_type, byte_size, created_at, listed_by)
        VALUES (${photoId}, ${placeId}, ${userId}, ${photo.r2Key}, ${photo.contentType}, ${photo.byteSize}, ${now}, 'restaurant')`,
  ]);
  return { ok: true, value: { photoId } };
}

/**
 * File the restaurant photo as a pending certificate. A moderator still has to approve it in the
 * evidence queue before it can settle `certified`. Paying does not approve it.
 */
export async function fileOwnerCertificate(
  claimId: string,
  userId: string,
  photo: { r2Key: string; contentType: string; byteSize: number },
  certifier: string | null,
  expiresAt: number | null,
  client: Client = database(),
  now = Date.now(),
): Promise<Result<{ photoId: string; signalId: string }>> {
  const db = await client;
  const owned = await ownedClaim(db, claimId, userId, now);
  if (!owned.ok) return owned;
  const placeId = String(owned.value.place_id);
  const photoId = crypto.randomUUID();
  const signalId = crypto.randomUUID();
  await runBatch(db, [
    sql`INSERT INTO place_photos (id, place_id, user_id, r2_key, content_type, byte_size, created_at, listed_by)
        VALUES (${photoId}, ${placeId}, ${userId}, ${photo.r2Key}, ${photo.contentType}, ${photo.byteSize}, ${now}, 'restaurant')`,
    sql`INSERT INTO place_signals (id, place_id, source, certified, photo_id, submitted_by_user_id, certifier, expires_at, review_status, created_at, updated_at)
        VALUES (${signalId}, ${placeId}, 'certificate', 'yes', ${photoId}, ${userId}, ${certifier}, ${expiresAt}, 'pending', ${now}, ${now})`,
  ]);
  return { ok: true, value: { photoId, signalId } };
}

/** Count one place-page view for this UTC day. Callers already decided this IP may count. */
export async function recordPlaceView(placeId: string, client: Client = database(), now = Date.now()): Promise<void> {
  const db = await client;
  const day = utcDay(now);
  const [place] = await db.all<{ id: string }>(sql`SELECT id FROM places WHERE id = ${placeId} AND listing_status = 'listed'`);
  if (!place) return;
  await runBatch(db, [
    sql`INSERT INTO place_view_days (place_id, day, views) VALUES (${placeId}, ${day}, 1)
        ON CONFLICT(place_id, day) DO UPDATE SET views = views + 1`,
  ]);
}

export async function placeListed(placeId: string, client: Client = database()): Promise<boolean> {
  const db = await client;
  const [place] = await db.all<{ id: string }>(sql`SELECT id FROM places WHERE id = ${placeId} AND listing_status = 'listed'`);
  return Boolean(place);
}

/** Last 30 UTC days of view counts for the restaurant the buyer claims. */
export async function claimViewSeries(
  claimId: string,
  userId: string,
  client: Client = database(),
  now = Date.now(),
): Promise<Result<ViewDay[]>> {
  const db = await client;
  const row = await claimById(db, claimId);
  if (!row || row.user_id !== userId) return fail(404, "That claim could not be found.");
  const placeId = String(row.place_id);
  const start = fillViewDays([], now).at(0)?.day ?? utcDay(now);
  const rows = await db.all<{ day: string; views: number }>(sql`
    SELECT day, views FROM place_view_days WHERE place_id = ${placeId} AND day >= ${start} ORDER BY day ASC
  `);
  return { ok: true, value: fillViewDays(rows.map((item) => ({ day: item.day, views: Number(item.views) })), now) };
}

async function findClaimForPayment(db: DatabaseClient, event: Extract<OwnerClaimEvent, { type: "payment.succeeded" }>): Promise<Row | null> {
  if (event.claimId) {
    const row = await claimById(db, event.claimId);
    if (row) return row;
  }
  if (event.checkoutId) {
    const [row] = await db.all<Row>(sql`SELECT * FROM owner_claims WHERE whop_checkout_id = ${event.checkoutId}`);
    if (row) return row;
  }
  if (event.membershipId) {
    const [row] = await db.all<Row>(sql`SELECT * FROM owner_claims WHERE whop_membership_id = ${event.membershipId} ORDER BY created_at DESC LIMIT 1`);
    if (row) return row;
  }
  return null;
}

/** Apply one restaurant-claim webhook. The sponsorship handler records the delivery id. */
export async function applyOwnerClaimEvent(event: OwnerClaimEvent, client: Client = database(), now = Date.now()): Promise<"applied" | "unmatched" | "duplicate"> {
  const db = await client;
  if (event.type === "payment.succeeded") {
    const row = await findClaimForPayment(db, event);
    if (!row || row.status === "removed" || row.status === "refunded" || row.status === "ended") return "unmatched";
    if (row.whop_payment_id === event.paymentId && row.status === "active") return "duplicate";
    const window = claimPaidWindow(state(row), event.paidAt);
    await runBatch(db, [
      sql`UPDATE owner_claims SET status = 'active', renews = 1, starts_at = ${window.startsAt}, active_until = ${window.activeUntil},
          whop_payment_id = ${event.paymentId}, whop_membership_id = COALESCE(${event.membershipId}, whop_membership_id), updated_at = ${now}
          WHERE id = ${String(row.id)}`,
    ]);
    return "applied";
  }
  if (event.type === "membership.deactivated" || event.type === "membership.renewing") {
    await runBatch(db, [
      sql`UPDATE owner_claims SET renews = ${event.type === "membership.renewing" ? 1 : 0}, updated_at = ${now}
          WHERE status = 'active' AND (whop_membership_id = ${event.membershipId} OR (${event.claimId} IS NOT NULL AND id = ${event.claimId}))`,
    ]);
    return "applied";
  }
  if (event.type !== "refund") return "unmatched";
  await runBatch(db, [
    sql`UPDATE owner_claims SET status = 'refunded', renews = 0, updated_at = ${now}
        WHERE status IN ('active', 'pending') AND ((${event.paymentId} IS NOT NULL AND whop_payment_id = ${event.paymentId})
          OR (${event.membershipId} IS NOT NULL AND whop_membership_id = ${event.membershipId}))`,
  ]);
  return "applied";
}

export type AdminClaim = {
  id: string;
  placeId: string;
  placeName: string;
  citySlug: string;
  role: ClaimRole;
  contactEmail: string;
  status: ClaimStatus;
  review: ClaimReview;
  buyer: string | null;
  activeUntil: number | null;
  public: boolean;
};

/** Paid claims for the moderation console. Contact email is for the reviewer, not the public site. */
export async function listClaimsForAdmin(client: Client = database(), now = Date.now()): Promise<AdminClaim[]> {
  const db = await client;
  const rows = await db.all<Row>(sql`
    SELECT c.*, p.name AS place_name, p.city_slug, pr.handle
    FROM owner_claims c
    JOIN places p ON p.id = c.place_id
    LEFT JOIN profiles pr ON pr.user_id = c.user_id
    WHERE c.status IN ('active', 'removed')
    ORDER BY c.created_at DESC
    LIMIT 100
  `);
  return rows.map((row) => {
    const current = state(row);
    return {
      id: current.id,
      placeId: String(row.place_id),
      placeName: String(row.place_name),
      citySlug: String(row.city_slug),
      role: row.role === "manager" ? "manager" : "owner",
      contactEmail: String(row.contact_email),
      status: current.status,
      review: current.review,
      buyer: (row.handle as string | null) ?? null,
      activeUntil: current.activeUntil,
      public: isPublicClaim(current, now),
    };
  });
}

/** Approve, decline, take down or restore a claim. Audited. Does not change halal facts. */
export async function moderateOwnerClaim(
  id: string,
  moderatorId: string,
  action: ModerateClaimAction,
  reason: string | null,
  client: Client = database(),
  now = Date.now(),
): Promise<Result<{ ok: true }>> {
  const db = await client;
  const row = await claimById(db, id);
  if (!row) return fail(404, "That claim could not be found.");
  const current = state(row);
  const next = moderateClaimTransition(current, action);
  if (!next.ok) return fail(409, next.error);
  await runBatch(db, [
    sql`UPDATE owner_claims SET status = ${next.value.status}, review_status = ${next.value.review},
          reviewed_by_user_id = ${moderatorId}, reviewed_at = ${now}, updated_at = ${now}
        WHERE id = ${id}`,
    sql`INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, before_value, after_value, created_at)
        VALUES (${crypto.randomUUID()}, ${moderatorId}, ${`${action}-owner-claim`}, 'owner_claim', ${id}, ${reason},
          ${JSON.stringify({ status: current.status, review: current.review })},
          ${JSON.stringify({ status: next.value.status, review: next.value.review })}, ${now})`,
  ]);
  return { ok: true, value: { ok: true } };
}
