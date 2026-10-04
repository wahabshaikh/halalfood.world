import { sql } from "drizzle-orm";
import type { ValidatedLinkSubmission } from "@halalfood/core/place-submission";
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
        source === "google"
          ? "Waiting for a person to review this Google place. Not listed and not a halal certification."
          : "Waiting for a person to check the link. Not listed and not a halal certification."
      },
      ${now}, ${now}
    )
  `);
  return { ok: true, id, status: "pending", deduped: false };
}
