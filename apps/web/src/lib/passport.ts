import { sql } from "drizzle-orm";
import { buildFoodPassport, buildMilestones, type FoodPassport, type Milestone } from "@halalfood/core/food-passport";
import { database } from "../db";
import { parseCuisines } from "./place-view";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type PassportView = {
  passport: FoodPassport;
  milestones: Milestone[];
  pins: { placeId: string; lat: number; lng: number }[];
};

/** The food passport on /me: coverage counts, milestones and a pin per place checked. */
export async function loadPassport(userId: string, helpedVerify: number, client: Client = database()): Promise<PassportView> {
  const db = await client;
  // check-visibility: owner-only — the signed-in user's own checks.
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT c.place_id, c.created_at, p.city_slug, p.address_country, p.serves_cuisine, p.lat, p.lng
    FROM checks c JOIN places p ON p.id = c.place_id
    WHERE c.user_id = ${userId} AND c.excluded = 0
  `);
  const passport = buildFoodPassport(
    rows.map((row) => ({
      placeId: String(row.place_id),
      citySlug: String(row.city_slug),
      country: (row.address_country as string | null) ?? null,
      cuisines: parseCuisines(row.serves_cuisine),
      createdAt: Number(row.created_at),
    })),
  );
  const pins = new Map<string, { placeId: string; lat: number; lng: number }>();
  for (const row of rows)
    if (row.lat !== null && row.lng !== null)
      pins.set(String(row.place_id), { placeId: String(row.place_id), lat: Number(row.lat), lng: Number(row.lng) });
  return { passport, milestones: buildMilestones(passport, helpedVerify), pins: [...pins.values()] };
}
