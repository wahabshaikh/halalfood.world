/**
 * D1 access for dietary standards and the public diner profile.
 *
 * A profile is addressed by a pseudonymous handle, never by user id or email,
 * so a public diner page can be shared without exposing an account.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  DEFAULT_PREFERENCES,
  type MinimumStatus,
  type UserPreferences,
} from "@halalfood/core/user-preferences";
import { MINIMUM_STATUS_OPTIONS } from "@halalfood/core/user-preferences";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function bool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

function stringArray(value: unknown): string[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

export async function getPreferences(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<UserPreferences> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT * FROM user_preferences WHERE user_id = ${userId} LIMIT 1
  `);
  const row = rows[0];
  if (!row) return { ...DEFAULT_PREFERENCES };

  const minimumStatus = MINIMUM_STATUS_OPTIONS.includes(
    row.minimum_status as MinimumStatus,
  )
    ? (row.minimum_status as MinimumStatus)
    : DEFAULT_PREFERENCES.minimumStatus;

  const maxAge = Number(row.max_evidence_age_days);

  return {
    minimumStatus,
    requireCertification: bool(row.require_certification),
    avoidAlcohol: bool(row.avoid_alcohol),
    avoidPork: bool(row.avoid_pork),
    requireDedicatedKitchen: bool(row.require_dedicated_kitchen),
    requirePrayerSpace: bool(row.require_prayer_space),
    vegetarianOnly: bool(row.vegetarian_only),
    maxEvidenceAgeDays: Number.isInteger(maxAge) && maxAge > 0 ? maxAge : null,
    allergies: stringArray(row.allergies),
    cuisines: stringArray(row.cuisines),
    homeCitySlug:
      typeof row.home_city_slug === "string" ? row.home_city_slug : null,
    visibilityVisits: row.visibility_visits === "private" ? "private" : "public",
    visibilityLists: row.visibility_lists === "private" ? "private" : "public",
  };
}

export async function savePreferences(
  userId: string,
  preferences: UserPreferences,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<void> {
  const db = await client;
  const now = Date.now();
  await db.run(sql`
    INSERT INTO user_preferences (
      user_id, minimum_status, require_certification, avoid_alcohol, avoid_pork,
      require_dedicated_kitchen, require_prayer_space, vegetarian_only,
      max_evidence_age_days, allergies, cuisines, home_city_slug,
      visibility_visits, visibility_lists, created_at, updated_at
    ) VALUES (
      ${userId}, ${preferences.minimumStatus}, ${preferences.requireCertification ? 1 : 0},
      ${preferences.avoidAlcohol ? 1 : 0}, ${preferences.avoidPork ? 1 : 0},
      ${preferences.requireDedicatedKitchen ? 1 : 0}, ${preferences.requirePrayerSpace ? 1 : 0},
      ${preferences.vegetarianOnly ? 1 : 0}, ${preferences.maxEvidenceAgeDays},
      ${JSON.stringify(preferences.allergies)}, ${JSON.stringify(preferences.cuisines)},
      ${preferences.homeCitySlug}, ${preferences.visibilityVisits},
      ${preferences.visibilityLists}, ${now}, ${now}
    )
    ON CONFLICT(user_id) DO UPDATE SET
      minimum_status = excluded.minimum_status,
      require_certification = excluded.require_certification,
      avoid_alcohol = excluded.avoid_alcohol,
      avoid_pork = excluded.avoid_pork,
      require_dedicated_kitchen = excluded.require_dedicated_kitchen,
      require_prayer_space = excluded.require_prayer_space,
      vegetarian_only = excluded.vegetarian_only,
      max_evidence_age_days = excluded.max_evidence_age_days,
      allergies = excluded.allergies,
      cuisines = excluded.cuisines,
      home_city_slug = excluded.home_city_slug,
      visibility_visits = excluded.visibility_visits,
      visibility_lists = excluded.visibility_lists,
      updated_at = excluded.updated_at
  `);
}

/* --------------------------------------------------------------- profile -- */

export type DinerProfile = {
  userId: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  homeCitySlug: string | null;
  createdAt: number;
};

const HANDLE = /^[a-z0-9](?:[a-z0-9_-]{1,30})[a-z0-9]$/;

export function isValidHandle(value: unknown): value is string {
  return typeof value === "string" && HANDLE.test(value);
}

/** Deterministic fallback handle so a profile never leaks an email address. */
export async function deriveHandle(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`halalfood:handle:${userId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .slice(0, 5)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `diner-${hex}`;
}

export async function getProfileByHandle(
  handle: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<DinerProfile | null> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT user_id, handle, display_name, bio, home_city_slug, created_at
    FROM user_profiles WHERE handle = ${handle} LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: String(row.user_id),
    handle: String(row.handle),
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    bio: typeof row.bio === "string" ? row.bio : null,
    homeCitySlug:
      typeof row.home_city_slug === "string" ? row.home_city_slug : null,
    createdAt: Number(row.created_at ?? 0),
  };
}

export async function getOrCreateProfile(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<DinerProfile> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT user_id, handle, display_name, bio, home_city_slug, created_at
    FROM user_profiles WHERE user_id = ${userId} LIMIT 1
  `);
  const existing = rows[0];
  if (existing)
    return {
      userId: String(existing.user_id),
      handle: String(existing.handle),
      displayName:
        typeof existing.display_name === "string" ? existing.display_name : null,
      bio: typeof existing.bio === "string" ? existing.bio : null,
      homeCitySlug:
        typeof existing.home_city_slug === "string" ? existing.home_city_slug : null,
      createdAt: Number(existing.created_at ?? 0),
    };

  const handle = await deriveHandle(userId);
  const now = Date.now();
  await db.run(sql`
    INSERT INTO user_profiles (user_id, handle, display_name, bio, home_city_slug, created_at, updated_at)
    VALUES (${userId}, ${handle}, NULL, NULL, NULL, ${now}, ${now})
    ON CONFLICT(user_id) DO NOTHING
  `);
  return {
    userId,
    handle,
    displayName: null,
    bio: null,
    homeCitySlug: null,
    createdAt: now,
  };
}

export type ProfileUpdate = {
  handle?: string;
  displayName?: string | null;
  bio?: string | null;
  homeCitySlug?: string | null;
};

export async function updateProfile(
  userId: string,
  update: ProfileUpdate,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<void> {
  const db = await client;
  const current = await getOrCreateProfile(userId, client);
  await db.run(sql`
    UPDATE user_profiles SET
      handle = ${update.handle ?? current.handle},
      display_name = ${update.displayName === undefined ? current.displayName : update.displayName},
      bio = ${update.bio === undefined ? current.bio : update.bio},
      home_city_slug = ${update.homeCitySlug === undefined ? current.homeCitySlug : update.homeCitySlug},
      updated_at = ${Date.now()}
    WHERE user_id = ${userId}
  `);
}

/** Is this account allowed to use the moderation console? */
export async function getModeratorRole(
  userId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<"moderator" | "admin" | null> {
  const db = await client;
  const rows = await db.all<{ role?: unknown }>(sql`
    SELECT role FROM moderators WHERE user_id = ${userId} LIMIT 1
  `);
  const role = rows[0]?.role;
  return role === "admin" || role === "moderator" ? role : null;
}
