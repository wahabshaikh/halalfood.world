import { sql } from "drizzle-orm";
import { parseFilters, type Filter } from "@halalfood/core/halal";
import { database } from "../db";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type Profile = {
  userId: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarKey: string | null;
  homeCitySlug: string | null;
  isPrivate: boolean;
  listsPrivateDefault: boolean;
  showOnLeaderboards: boolean;
  defaultFilters: Filter[];
  onboarded: boolean;
  suspended: boolean;
  invitedByUserId: string | null;
  createdAt: number;
};

export function toProfile(row: Record<string, unknown>): Profile {
  const filters = (() => {
    try {
      const parsed = JSON.parse(String(row.default_filters ?? "[]"));
      return Array.isArray(parsed) ? parseFilters(parsed.join(",")) : [];
    } catch {
      return [];
    }
  })();
  return {
    userId: String(row.user_id),
    handle: String(row.handle),
    displayName: String(row.display_name ?? row.handle),
    bio: (row.bio as string | null) ?? null,
    avatarKey: (row.avatar_key as string | null) ?? null,
    homeCitySlug: (row.home_city_slug as string | null) ?? null,
    isPrivate: Number(row.is_private) === 1,
    listsPrivateDefault: Number(row.lists_private_default) === 1,
    showOnLeaderboards: Number(row.show_on_leaderboards) === 1,
    defaultFilters: filters,
    onboarded: row.onboarded_at !== null && row.onboarded_at !== undefined,
    suspended: row.suspended_at !== null && row.suspended_at !== undefined,
    invitedByUserId: (row.invited_by_user_id as string | null) ?? null,
    createdAt: Number(row.created_at),
  };
}

export async function getProfile(userId: string, client: Client = database()): Promise<Profile | null> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`SELECT * FROM profiles WHERE user_id = ${userId} LIMIT 1`);
  return rows[0] ? toProfile(rows[0]) : null;
}

export async function getProfileByHandle(handle: string, client: Client = database()): Promise<Profile | null> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT * FROM profiles WHERE lower(handle) = lower(${handle}) LIMIT 1
  `);
  return rows[0] ? toProfile(rows[0]) : null;
}

export function avatarUrl(key: string | null, handle: string): string | null {
  return key ? `/api/avatars/${encodeURIComponent(handle)}` : null;
}
