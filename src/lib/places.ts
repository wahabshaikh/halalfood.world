import { sql } from "drizzle-orm";
import { database } from "../db";

import { bboxParam } from "./params";

export type Place = {
  id: string;
  name: string;
  city_slug: string;
  street_address: string;
  address_locality: string | null;
  address_country: string | null;
  telephone: string | null;
  website: string | null;
  rating_value: string | null;
  review_count: number | null;
  lat: number;
  lng: number;
};
export async function findPlaces(options: {
  bbox?: ReturnType<typeof bboxParam>;
  q?: string;
  limit: number;
}) {
  const conditions = [sql`lat IS NOT NULL AND lng IS NOT NULL`];
  if (options.bbox) {
    const { west, south, east, north } = options.bbox;
    conditions.push(sql`lat BETWEEN ${south} AND ${north}`);
    conditions.push(
      west <= east
        ? sql`lng BETWEEN ${west} AND ${east}`
        : sql`(lng >= ${west} OR lng <= ${east})`,
    );
  }
  if (options.q) {
    const term = "%" + options.q.replace(/[\\%_]/g, "\\$&") + "%";
    conditions.push(
      sql`(name ILIKE ${term} OR replace(city_slug, '-', ' ') ILIKE ${term} OR street_address ILIKE ${term} OR address_locality ILIKE ${term})`,
    );
  }
  const result = await database().execute(sql`
    SELECT id, name, city_slug, street_address, address_locality, address_country,
      telephone, website, rating_value, review_count, lat, lng, count(*) OVER()::integer AS total
    FROM places WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY rating_value DESC NULLS LAST, review_count DESC NULLS LAST, id
    LIMIT ${options.limit}
  `);
  const rows = result.rows as unknown as (Place & { total: number })[];
  return {
    places: rows.map(({ total: _total, ...place }) => place),
    total: rows[0]?.total ?? 0,
    limit: options.limit,
  };
}
