import { sql } from "drizzle-orm";
import { database } from "@/lib/db";
import { LISTED, PLACE_CARD_COLUMNS, PLACE_CARD_FROM, toPlaceCard, type PlaceCard } from "./place-view";
import { listCities, searchPlaces as searchSingleWord } from "./places";
import { normalizeSearchQuery, splitCityQuery } from "./search-query";
import { containsText } from "./text-search";

type Client = Awaited<ReturnType<typeof database>>;

/** Search places by city and up to four words, preserving single-word matching. */
export async function searchPlaces(
  rawQuery: string,
  options: { limit?: number; citySlug?: string | null } = {},
  client?: Client,
): Promise<PlaceCard[]> {
  const q = normalizeSearchQuery(rawQuery);
  if (!q) return [];
  const cities = await listCities({ limit: 2000 }, client);
  const { citySlug, rest } = splitCityQuery(q, cities.map((city) => city.city_slug));
  if (!citySlug && !q.includes(" ")) return searchSingleWord(q, options, client);

  const conditions = [LISTED];
  if (citySlug) conditions.push(sql`p.city_slug = ${citySlug}`);
  // At most 4 words × 5 fields × 4 spellings = 80 match parameters.
  for (const word of rest ? rest.split(" ").slice(0, 4) : []) {
    conditions.push(sql`(${sql.join([
      containsText(sql`p.name`, word),
      containsText(sql`p.serves_cuisine`, word),
      containsText(sql`p.address_locality`, word),
      containsText(sql`p.street_address`, word),
      // check-visibility: aggregate — matches dish names only, no author is exposed.
      sql`EXISTS (SELECT 1 FROM checks c JOIN check_dishes d ON d.check_id = c.id
        WHERE c.place_id = p.id AND c.excluded = 0 AND ${containsText(sql`d.name`, word)})`,
    ], sql` OR `)})`);
  }
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 5) || 1, 1), 50);
  const cityFirst = options.citySlug ? sql`CASE WHEN p.city_slug = ${options.citySlug} THEN 0 ELSE 1 END,` : sql``;
  const db = client ?? await database();
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${PLACE_CARD_COLUMNS}
    FROM ${PLACE_CARD_FROM}
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY ${cityFirst} CASE WHEN ${containsText(sql`p.name`, rest)} THEN 0 ELSE 1 END,
      CASE s.status WHEN 'verified' THEN 0 WHEN 'checking' THEN 1 ELSE 2 END, p.name, p.id
    LIMIT ${limit}
  `);
  return rows.map(toPlaceCard);
}
