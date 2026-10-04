import { sql } from "drizzle-orm";
import { database } from "../db";
import { citySlugFromAddress, lowerSpaced, sameVenueName, streetAddressKeys } from "./place-match";

export { citySlugFromAddress, sameVenueName, streetAddressKeys };

type DatabaseClient = Awaited<ReturnType<typeof database>>;

/**
 * What an add-place submission would duplicate.
 * - listed: a public place. The person is sent to it.
 * - unlisted: a place row that is hidden or not yet confirmed. It is not public,
 *   so there is no link, but it must not be filed again.
 * - pending: a submission waiting for a moderator.
 */
export type ExistingPlaceMatch =
  | { kind: "listed"; placeId: string; name: string }
  | { kind: "unlisted"; placeId: string; name: string }
  | { kind: "pending"; submissionId: string; name: string; submittedByUserId: string };

export type DuplicateCandidate = {
  googlePlaceId: string | null;
  name: string;
  citySlug: string;
  address: string;
};

type PlaceRow = {
  id: string;
  name: string;
  city_slug: string;
  street_address: string | null;
  google_place_id: string | null;
  listed: number;
};

function placeMatch(row: PlaceRow): ExistingPlaceMatch {
  return row.listed
    ? { kind: "listed", placeId: row.id, name: row.name }
    : { kind: "unlisted", placeId: row.id, name: row.name };
}

/**
 * Existing places and pending submissions for a batch of Google results.
 * Matches by Google place id first (any place row, any pending submission),
 * then a listed place with the same name in the city, then a listed place at
 * the same street address with the same venue name. Three reads, no writes.
 */
export async function findExistingPlaces(
  candidates: DuplicateCandidate[],
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<Array<ExistingPlaceMatch | null>> {
  if (candidates.length === 0) return [];
  const db = await client;
  const ids = [...new Set(candidates.map((c) => c.googlePlaceId).filter((id): id is string => Boolean(id)))];
  const cities = [...new Set(candidates.map((c) => c.citySlug).filter(Boolean))];
  const names = [...new Set(candidates.map((c) => lowerSpaced(c.name)).filter(Boolean))];
  const streets = [...new Set(candidates.flatMap((c) => streetAddressKeys(c.address)))];

  const byId = ids.length
    ? await db.all<PlaceRow>(sql`
        SELECT id, name, city_slug, street_address, google_place_id,
          (halal_confirmed = 1 AND listing_status = 'listed') AS listed
        FROM places
        WHERE google_place_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)
    : [];
  const pending = ids.length
    ? await db.all<{ id: string; name: string; google_place_id: string; submitted_by_user_id: string }>(sql`
        SELECT id, name, google_place_id, submitted_by_user_id FROM place_link_submissions
        WHERE status = 'pending'
          AND google_place_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        ORDER BY created_at ASC
      `)
    : [];
  const nearby =
    cities.length && (names.length || streets.length)
      ? await db.all<PlaceRow>(sql`
          SELECT id, name, city_slug, street_address, google_place_id, 1 AS listed
          FROM places
          WHERE halal_confirmed = 1 AND listing_status = 'listed'
            AND city_slug IN (${sql.join(cities.map((city) => sql`${city}`), sql`, `)})
            AND (
              lower(name) IN (${sql.join((names.length ? names : [""]).map((name) => sql`${name}`), sql`, `)})
              OR lower(trim(street_address)) IN (${sql.join((streets.length ? streets : [""]).map((street) => sql`${street}`), sql`, `)})
            )
          LIMIT 200
        `)
      : [];

  return candidates.map((candidate) => {
    if (candidate.googlePlaceId) {
      const place = byId.find((row) => row.google_place_id === candidate.googlePlaceId);
      if (place) return placeMatch(place);
      const submission = pending.find((row) => row.google_place_id === candidate.googlePlaceId);
      if (submission) {
        return {
          kind: "pending",
          submissionId: submission.id,
          name: submission.name,
          submittedByUserId: submission.submitted_by_user_id,
        };
      }
    }
    const inCity = nearby.filter((row) => row.city_slug === candidate.citySlug);
    const sameName = inCity.find((row) => lowerSpaced(row.name) === lowerSpaced(candidate.name));
    if (sameName) return placeMatch(sameName);
    const streetKeys = new Set(streetAddressKeys(candidate.address));
    const sameStreet = inCity.find(
      (row) =>
        row.street_address &&
        streetKeys.has(lowerSpaced(row.street_address)) &&
        sameVenueName(row.name, candidate.name, candidate.citySlug),
    );
    return sameStreet ? placeMatch(sameStreet) : null;
  });
}

export async function findExistingPlace(
  candidate: DuplicateCandidate,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<ExistingPlaceMatch | null> {
  const [match] = await findExistingPlaces([candidate], client);
  return match ?? null;
}

/**
 * The 409 body for a duplicate. A listed place carries its id and URL. A hidden
 * or unconfirmed place is not public, so its id is not given out.
 */
export function duplicateBody(match: ExistingPlaceMatch, userId?: string) {
  if (match.kind === "listed") {
    return {
      error: `${match.name} is already listed.`,
      code: "already_listed",
      id: match.placeId,
      placeId: match.placeId,
      url: `/place/${match.placeId}`,
    };
  }
  if (match.kind === "unlisted") {
    return {
      error: `${match.name} is already known to us and was reviewed, so it can't be added again.`,
      code: "already_known",
      placeId: null,
      url: null,
    };
  }
  const mine = Boolean(userId) && match.submittedByUserId === userId;
  return {
    error: mine
      ? `You already sent ${match.name}. It is waiting for review.`
      : `${match.name} was already sent and is waiting for review.`,
    code: "already_pending",
    mine,
    submissionId: mine ? match.submissionId : null,
    placeId: null,
    url: null,
  };
}
