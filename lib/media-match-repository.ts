/**
 * Candidate places for a pasted reel. The caption is reduced to a few
 * distinctive words, the places table is searched for names containing any of
 * them, and the pure matcher in core decides which candidates really appear in
 * the text. Only listed halal places can be matched.
 */

import { sql } from "drizzle-orm";
import { containsText, normalizeSearchQuery } from "./text-search";
import { database } from "@/lib/db";
import {
  captionSearchTerms,
  matchPlaces,
  type PlaceMatch,
} from "@/lib/core/media-match";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

const CANDIDATE_LIMIT = 150;

export type MatchedPlace = PlaceMatch & { streetAddress: string };

export async function matchPlacesForCaption(
  caption: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<MatchedPlace[]> {
  const terms = captionSearchTerms(caption);
  if (!terms.length) return [];
  const db = await client;
  const conditions = terms.map(
    (term) => containsText(sql`p.name`, normalizeSearchQuery(term)),
  );
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT p.id, p.name, p.city_slug, p.address_locality, p.street_address
    FROM places AS p
    WHERE p.listing_status = 'listed' AND (${sql.join(conditions, sql` OR `)})
    LIMIT ${CANDIDATE_LIMIT}
  `);
  const address = new Map(rows.map((row) => [String(row.id), String(row.street_address ?? "")]));
  return matchPlaces(
    caption,
    rows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      citySlug: String(row.city_slug ?? ""),
      addressLocality: typeof row.address_locality === "string" ? row.address_locality : null,
    })),
  ).map((match) => ({ ...match, streetAddress: address.get(match.id) ?? "" }));
}
