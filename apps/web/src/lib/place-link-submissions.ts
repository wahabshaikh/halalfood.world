import { sql } from "drizzle-orm";
import type { ValidatedLinkSubmission } from "@halalfood/core/place-submission";
import { isUniqueConstraint } from "./domain-error";
import { writeAudit } from "./contributions-repository";
import { database } from "../db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export type ListedMatch = { id: string; name: string };

export type LinkSubmissionResult =
  | { ok: true; id: string; status: string; deduped: boolean }
  | { ok: false; reason: "duplicate"; place: ListedMatch };

/** A listed place with the same Google id, or the same name in the same city. */
export async function findListedPlace(
  input: { googlePlaceId: string | null; name: string; citySlug: string },
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<ListedMatch | null> {
  const db = await client;
  const rows = await db.all<ListedMatch>(sql`
    SELECT id, name FROM places
    WHERE halal_confirmed = 1 AND listing_status = 'listed'
      AND (
        (${input.googlePlaceId} IS NOT NULL AND google_place_id = ${input.googlePlaceId})
        OR (lower(name) = lower(${input.name}) AND city_slug = ${input.citySlug})
      )
    LIMIT 1
  `);
  const row = rows[0];
  return row?.id ? { id: row.id, name: row.name } : null;
}

/**
 * Store a place link for review. The same person sending the same link again
 * gets the original row. Nothing here is published or treated as certified.
 */
export async function submitPlaceLink(
  userId: string,
  input: ValidatedLinkSubmission,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
  source: "link" | "google" = "link",
  statusReason?: string,
): Promise<LinkSubmissionResult> {
  const db = await client;
  const listed = await findListedPlace(
    { googlePlaceId: input.googlePlaceId, name: input.name, citySlug: input.citySlug },
    db,
  );
  if (listed) return { ok: false, reason: "duplicate", place: listed };

  const existing = await db.all<{ id: string; status: string }>(sql`
    SELECT id, status FROM place_link_submissions
    WHERE submitted_by_user_id = ${userId} AND source_url = ${input.sourceUrl}
    LIMIT 1
  `);
  if (existing[0]) return { ok: true, id: existing[0].id, status: existing[0].status, deduped: true };

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.run(sql`
    INSERT INTO place_link_submissions (
      id, submitted_by_user_id, name, city_slug, street_address, source_url,
      google_place_id, status, status_reason, created_at, updated_at
    ) VALUES (
      ${id}, ${userId}, ${input.name}, ${input.citySlug}, ${input.address},
      ${input.sourceUrl}, ${input.googlePlaceId}, 'pending',
      ${
        statusReason ??
        (source === "google"
          ? "Waiting for a person to review this Google place. Not listed and not a halal certification."
          : "Waiting for a person to check the link. Not listed and not a halal certification.")
      },
      ${now}, ${now}
    )
  `);
  return { ok: true, id, status: "pending", deduped: false };
}

export type PendingPlaceSubmission = {
  id: string;
  name: string;
  citySlug: string;
  streetAddress: string;
  sourceUrl: string;
  googlePlaceId: string | null;
  filingNote: string | null;
  createdAt: number;
  submittedByUserId: string;
};

/** Oldest pending place links first. Nothing here is a public listing yet. */
export async function listPendingPlaceSubmissions(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PendingPlaceSubmission[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, name, city_slug, street_address, source_url, google_place_id,
      status_reason, created_at, submitted_by_user_id
    FROM place_link_submissions
    WHERE status = 'pending'
    ORDER BY created_at ASC, id ASC
    LIMIT 100
  `);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    citySlug: String(row.city_slug ?? ""),
    streetAddress: String(row.street_address ?? ""),
    sourceUrl: String(row.source_url ?? ""),
    googlePlaceId: typeof row.google_place_id === "string" ? row.google_place_id : null,
    filingNote: typeof row.status_reason === "string" ? row.status_reason : null,
    createdAt: typeof row.created_at === "number" ? row.created_at : 0,
    submittedByUserId: String(row.submitted_by_user_id ?? ""),
  }));
}

type SubmissionRow = {
  id: string;
  name: string;
  city_slug: string;
  street_address: string;
  source_url: string;
  google_place_id: string | null;
  status: string;
  submitted_by_user_id: string;
};

async function loadPendingSubmission(
  db: DatabaseClient,
  id: string,
): Promise<SubmissionRow | null> {
  const rows = await db.all<SubmissionRow>(sql`
    SELECT id, name, city_slug, street_address, source_url, google_place_id,
      status, submitted_by_user_id
    FROM place_link_submissions
    WHERE id = ${id}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row || row.status !== "pending") return null;
  return row;
}

type MatchedPlace = { id: string; publiclyListed: boolean };

/**
 * A place already in the table that this submission names. A hidden or
 * not-halal row was hidden on purpose (0020, 0022, moderation), so approving
 * a link never lists it again; the moderator rejects the link instead.
 */
async function findPlaceForSubmission(
  db: DatabaseClient,
  row: SubmissionRow,
): Promise<MatchedPlace | null> {
  const rows = await db.all<{ id: string; listing_status: string; halal_confirmed: number }>(sql`
    SELECT id, listing_status, halal_confirmed FROM places
    WHERE (${row.google_place_id} IS NOT NULL AND google_place_id = ${row.google_place_id})
       OR (
         city_slug = ${row.city_slug}
         AND name = ${row.name}
         AND street_address = ${row.street_address}
       )
    LIMIT 1
  `);
  const row0 = rows[0];
  if (!row0) return null;
  return {
    id: row0.id,
    publiclyListed: row0.listing_status === "listed" && Number(row0.halal_confirmed) === 1,
  };
}

async function insertListedPlace(db: DatabaseClient, row: SubmissionRow): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.run(sql`
    INSERT INTO places (
      id, name, city_slug, city_url, list_position, street_address,
      address_locality, address_region, postal_code, address_country,
      telephone, website, maps_url, google_place_id, serves_cuisine,
      rating_value, review_count, source, source_url, scraped_at, created_at,
      lat, lng, submitted_by_user_id, halal_confirmed, listing_status
    ) VALUES (
      ${id}, ${row.name}, ${row.city_slug}, ${`/city/${row.city_slug}`}, NULL,
      ${row.street_address}, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, ${row.google_place_id}, ${JSON.stringify([])},
      NULL, NULL, 'user-submitted', ${row.source_url}, ${now}, ${now},
      NULL, NULL, ${row.submitted_by_user_id}, 1, 'listed'
    )
  `);
  return id;
}

export type PlaceReviewResult =
  | { ok: true; placeId: string | null }
  | { ok: false; reason: "not-found" | "hidden-match"; placeId?: string };

/**
 * Approve lists the place. Reject stores the moderator's reason on the
 * submission, which the submitter already reads on their contributions.
 * Who and when live on the audit log.
 */
export async function reviewPlaceSubmission(
  id: string,
  moderatorUserId: string,
  decision: "approved" | "rejected",
  reason: string | null,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PlaceReviewResult> {
  const db = await client;
  const row = await loadPendingSubmission(db, id);
  if (!row) return { ok: false, reason: "not-found" };
  const now = Date.now();

  if (decision === "rejected") {
    await db.run(sql`
      UPDATE place_link_submissions
      SET status = 'rejected', status_reason = ${reason}, updated_at = ${now}
      WHERE id = ${id} AND status = 'pending'
    `);
    await writeAudit(
      {
        actorUserId: moderatorUserId,
        action: "place.rejected",
        targetType: "place-submission",
        targetId: id,
        reason,
        source: "moderation",
        before: { status: "pending" },
        after: { status: "rejected" },
      },
      db,
    );
    return { ok: true, placeId: null };
  }

  let match = await findPlaceForSubmission(db, row);
  if (!match) {
    try {
      match = { id: await insertListedPlace(db, row), publiclyListed: true };
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      match = await findPlaceForSubmission(db, row);
      if (!match) throw error;
    }
  }
  // Never flip a hidden or not-halal row back to listed from a link review.
  if (!match.publiclyListed) return { ok: false, reason: "hidden-match", placeId: match.id };
  const placeId = match.id;

  const listedReason = "A moderator listed this place. It is not a halal certification.";
  await db.run(sql`
    UPDATE place_link_submissions
    SET status = 'accepted', status_reason = ${listedReason},
      matched_place_id = ${placeId}, updated_at = ${now}
    WHERE id = ${id} AND status = 'pending'
  `);
  await writeAudit(
    {
      actorUserId: moderatorUserId,
      action: "place.listed",
      targetType: "place-submission",
      targetId: id,
      reason: null,
      source: "moderation",
      before: { status: "pending" },
      after: { status: "accepted", placeId, listingStatus: "listed" },
    },
    db,
  );
  return { ok: true, placeId };
}
