import { sql } from "drizzle-orm";
import { buildFoodPassport } from "@/lib/core/food-passport";
import type { Relation } from "@/lib/core/people";
import { database } from "@/lib/db";
import { visitsBy, type Visit } from "./feed";
import { listsOwnedBy, type ListSummary } from "./lists";
import { relationTo } from "./people";
import { parseCuisines } from "./place-view";
import { cityRank, getProfileByHandle, profileStats, type Profile } from "./profiles";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type PublicProfile = {
  profile: Profile;
  relation: Relation;
  /** False for a private account the viewer doesn't follow: header only. */
  canView: boolean;
  followers: number;
  following: number;
  rank: number | null;
  stats: { places: number; checks: number; cities: number; cuisines: number };
  lists: ListSummary[];
  visits: Visit[];
};

/** Someone's profile as the viewer may see it, or null (unknown, suspended, or they blocked the viewer). */
export async function loadPublicProfile(handle: string, viewerId: string | null, client: Client = database()): Promise<PublicProfile | null> {
  const db = await client;
  const profile = await getProfileByHandle(handle, db);
  if (!profile || profile.suspended) return null;
  if (viewerId && viewerId !== profile.userId) {
    const [blockedMe] = await db.all(sql`SELECT 1 FROM blocks WHERE blocker_id = ${profile.userId} AND blocked_id = ${viewerId}`);
    if (blockedMe) return null;
  }
  const relation = await relationTo(viewerId, profile, db);
  const canView = relation !== "blocked" && (!profile.isPrivate || relation === "self" || relation === "following");
  const counts = await profileStats(profile.userId, db);
  const rank = profile.homeCitySlug && profile.showOnLeaderboards ? await cityRank(profile.userId, profile.homeCitySlug, db) : null;
  let stats = { places: 0, checks: 0, cities: 0, cuisines: 0 };
  let lists: ListSummary[] = [];
  let visits: Visit[] = [];
  if (canView) {
    // check-visibility: aggregate — coverage counts over shared checks only.
    const rows = await db.all<Record<string, unknown>>(sql`
      SELECT c.place_id, c.created_at, p.city_slug, p.address_country, p.serves_cuisine
      FROM checks c JOIN places p ON p.id = c.place_id
      WHERE c.user_id = ${profile.userId} AND c.excluded = 0 AND c.shared = 1
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
    stats = { places: passport.places, checks: passport.checks, cities: passport.cities, cuisines: passport.cuisines };
    [lists, visits] = await Promise.all([listsOwnedBy(profile.userId, viewerId, db), visitsBy(profile.userId, viewerId, 20, db)]);
  }
  return { profile, relation, canView, followers: counts.followers, following: counts.following, rank, stats, lists, visits };
}
