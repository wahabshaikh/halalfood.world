import { sql, type SQL } from "drizzle-orm";
import { parseFilters, type Filter } from "@/lib/core/halal";
import { handleFromEmail, validateBio, validateDisplayName, validateHandle } from "@/lib/core/people";
import { database } from "@/lib/db";
import { runBatch } from "./checks-repository";

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

/** Where a profile photo is served from. The key's file name versions the URL, so a new upload busts caches. */
export function avatarUrl(key: string | null, handle: string): string | null {
  if (!key) return null;
  const version = key.split("/").pop()?.split(".")[0] ?? "";
  return `/api/avatars/${encodeURIComponent(handle)}?v=${encodeURIComponent(version)}`;
}

/* ------------------------------------------------------------------------ */
/* Create and edit                                                           */
/* ------------------------------------------------------------------------ */

export async function isHandleAvailable(handle: string, userId: string | null, client: Client = database()): Promise<boolean> {
  const db = await client;
  const rows = await db.all<{ user_id: string }>(sql`SELECT user_id FROM profiles WHERE lower(handle) = lower(${handle}) LIMIT 1`);
  return !rows[0] || rows[0].user_id === userId;
}

/** The signed-in person's profile, created on first use with a handle from their email. */
export async function ensureProfile(userId: string, client: Client = database(), now = Date.now()): Promise<Profile | null> {
  const existing = await getProfile(userId, client);
  if (existing) return existing;
  const db = await client;
  const [user] = await db.all<{ name: string; email: string }>(sql`SELECT name, email FROM "user" WHERE id = ${userId} LIMIT 1`);
  if (!user) return null;
  const base = handleFromEmail(user.email);
  const name = validateDisplayName(user.name);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const handle = attempt === 0 ? base : `${base.slice(0, 24)}${Math.floor(Math.random() * 9000 + 1000)}`;
    if (!(await isHandleAvailable(handle, userId, db))) continue;
    try {
      await db.run(sql`
        INSERT INTO profiles (user_id, handle, display_name, created_at, updated_at)
        VALUES (${userId}, ${handle}, ${name.ok ? name.displayName : null}, ${now}, ${now})
        ON CONFLICT (user_id) DO NOTHING
      `);
      return getProfile(userId, db);
    } catch (error) {
      if (!/unique/i.test(String(error))) throw error;
    }
  }
  throw new Error("Could not pick a free handle");
}

export type ProfilePatch = Partial<{
  displayName: string;
  handle: string;
  bio: string | null;
  homeCitySlug: string | null;
  defaultFilters: Filter[];
  isPrivate: boolean;
  listsPrivateDefault: boolean;
  showOnLeaderboards: boolean;
}>;

export type PatchResult = { ok: true; patch: ProfilePatch } | { ok: false; error: string };

/** Validate the fields of PUT /api/me. Unknown fields are ignored. */
export function parseProfilePatch(body: unknown): PatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a JSON object." };
  const input = body as Record<string, unknown>;
  const patch: ProfilePatch = {};
  if ("displayName" in input) {
    const name = validateDisplayName(input.displayName);
    if (!name.ok) return name;
    patch.displayName = name.displayName;
  }
  if ("handle" in input) {
    const handle = validateHandle(input.handle);
    if (!handle.ok) return handle;
    patch.handle = handle.handle;
  }
  if ("bio" in input) {
    const bio = validateBio(input.bio);
    if (!bio.ok) return bio;
    patch.bio = bio.bio;
  }
  if ("homeCitySlug" in input) {
    const slug = input.homeCitySlug;
    if (slug !== null && (typeof slug !== "string" || !/^[a-z0-9-]{1,120}$/.test(slug))) return { ok: false, error: "Choose a city from the list." };
    patch.homeCitySlug = slug as string | null;
  }
  if ("defaultFilters" in input) {
    if (!Array.isArray(input.defaultFilters)) return { ok: false, error: "Filters must be a list." };
    patch.defaultFilters = parseFilters(input.defaultFilters.filter((value) => typeof value === "string").join(","));
  }
  for (const key of ["isPrivate", "listsPrivateDefault", "showOnLeaderboards"] as const) {
    if (key in input) {
      if (typeof input[key] !== "boolean") return { ok: false, error: `${key} must be true or false.` };
      patch[key] = input[key] as boolean;
    }
  }
  return { ok: true, patch };
}

export async function updateProfile(
  userId: string,
  patch: ProfilePatch,
  client: Client = database(),
  now = Date.now(),
): Promise<{ ok: true; profile: Profile } | { ok: false; status: number; error: string }> {
  const db = await client;
  const current = await ensureProfile(userId, db, now);
  if (!current) return { ok: false, status: 404, error: "That account could not be found." };
  if (patch.handle && patch.handle !== current.handle && !(await isHandleAvailable(patch.handle, userId, db)))
    return { ok: false, status: 409, error: "That handle is taken." };
  const sets: SQL[] = [];
  if (patch.displayName !== undefined) sets.push(sql`display_name = ${patch.displayName}`);
  if (patch.handle !== undefined) sets.push(sql`handle = ${patch.handle}`);
  if (patch.bio !== undefined) sets.push(sql`bio = ${patch.bio}`);
  if (patch.homeCitySlug !== undefined) sets.push(sql`home_city_slug = ${patch.homeCitySlug}`);
  if (patch.defaultFilters !== undefined) sets.push(sql`default_filters = ${JSON.stringify(patch.defaultFilters)}`);
  if (patch.isPrivate !== undefined) sets.push(sql`is_private = ${patch.isPrivate ? 1 : 0}`);
  if (patch.listsPrivateDefault !== undefined) sets.push(sql`lists_private_default = ${patch.listsPrivateDefault ? 1 : 0}`);
  if (patch.showOnLeaderboards !== undefined) sets.push(sql`show_on_leaderboards = ${patch.showOnLeaderboards ? 1 : 0}`);
  if (sets.length) {
    sets.push(sql`updated_at = ${now}`);
    try {
      await db.run(sql`UPDATE profiles SET ${sql.join(sets, sql`, `)} WHERE user_id = ${userId}`);
    } catch (error) {
      if (/unique/i.test(String(error))) return { ok: false, status: 409, error: "That handle is taken." };
      throw error;
    }
    // Going public accepts everyone who was waiting.
    if (patch.isPrivate === false && current.isPrivate)
      await db.run(sql`UPDATE follows SET status = 'accepted', updated_at = ${now} WHERE followee_id = ${userId} AND status = 'pending'`);
  }
  return { ok: true, profile: (await getProfile(userId, db))! };
}

export async function setAvatarKey(userId: string, key: string | null, client: Client = database(), now = Date.now()) {
  const db = await client;
  await db.run(sql`UPDATE profiles SET avatar_key = ${key}, updated_at = ${now} WHERE user_id = ${userId}`);
}

export async function markOnboarded(userId: string, client: Client = database(), now = Date.now()) {
  const db = await client;
  await db.run(sql`UPDATE profiles SET onboarded_at = COALESCE(onboarded_at, ${now}), updated_at = ${now} WHERE user_id = ${userId}`);
}

/* ------------------------------------------------------------------------ */
/* Counts                                                                    */
/* ------------------------------------------------------------------------ */

export type ProfileStats = {
  followers: number;
  following: number;
  checks: number;
  placesAdded: number;
  helpedVerify: number;
  pendingRequests: number;
};

export async function profileStats(userId: string, client: Client = database()): Promise<ProfileStats> {
  const db = await client;
  // check-visibility: aggregate — counts only, no check content is exposed.
  const [row] = await db.all<Record<string, number>>(sql`
    SELECT
      (SELECT count(*) FROM follows WHERE followee_id = ${userId} AND status = 'accepted') AS followers,
      (SELECT count(*) FROM follows WHERE follower_id = ${userId} AND status = 'accepted') AS following,
      (SELECT count(*) FROM follows WHERE followee_id = ${userId} AND status = 'pending') AS pending_requests,
      (SELECT count(*) FROM checks WHERE user_id = ${userId} AND excluded = 0) AS checks,
      (SELECT count(*) FROM points WHERE user_id = ${userId} AND kind = 'place-added') AS places_added,
      (SELECT count(*) FROM points WHERE user_id = ${userId} AND kind = 'helped-verify') AS helped_verify
  `);
  return {
    followers: Number(row?.followers ?? 0),
    following: Number(row?.following ?? 0),
    checks: Number(row?.checks ?? 0),
    placesAdded: Number(row?.places_added ?? 0),
    helpedVerify: Number(row?.helped_verify ?? 0),
    pendingRequests: Number(row?.pending_requests ?? 0),
  };
}

/** All-time rank in a city by points, or null with no points there (spec §10). */
export async function cityRank(userId: string, citySlug: string, client: Client = database()): Promise<number | null> {
  const db = await client;
  const [row] = await db.all<{ rank: number }>(sql`
    WITH totals AS (
      SELECT pt.user_id, SUM(pt.points) AS total, MAX(pt.created_at) AS reached
      FROM points pt LEFT JOIN profiles pr ON pr.user_id = pt.user_id
      WHERE pt.city_slug = ${citySlug} AND COALESCE(pr.show_on_leaderboards, 1) = 1 AND pr.suspended_at IS NULL
      GROUP BY pt.user_id
    )
    SELECT rank FROM (
      SELECT user_id, RANK() OVER (ORDER BY total DESC, reached ASC) AS rank FROM totals
    ) WHERE user_id = ${userId}
  `);
  return row ? Number(row.rank) : null;
}

/* ------------------------------------------------------------------------ */
/* Delete account                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Delete an account. Checks stay so place statuses hold, but move to a fresh
 * anonymous tombstone user with the same account age: each deleted account
 * still counts as one independent person, and nothing links back to them.
 * Notes are cleared and the checks become unshared. Everything else cascades.
 * Returns the R2 keys the caller should delete (photos and the avatar).
 */
export async function deleteAccount(userId: string, client: Client = database(), now = Date.now()): Promise<string[]> {
  const db = await client;
  const [user] = await db.all<{ created_at: number }>(sql`SELECT created_at FROM "user" WHERE id = ${userId} LIMIT 1`);
  if (!user) return [];
  const keys = await db.all<{ key: string }>(sql`
    SELECT r2_key AS key FROM place_photos WHERE user_id = ${userId}
    UNION ALL SELECT avatar_key AS key FROM profiles WHERE user_id = ${userId} AND avatar_key IS NOT NULL
  `);
  const tombstone = `deleted-${crypto.randomUUID()}`;
  await runBatch(db, [
    sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${tombstone}, 'Deleted account', ${`${tombstone}@deleted.invalid`}, 0, ${user.created_at}, ${now})`,
    sql`UPDATE checks SET user_id = ${tombstone}, note = NULL, shared = 0, idempotency_key = id WHERE user_id = ${userId}`,
    sql`DELETE FROM "user" WHERE id = ${userId}`,
  ]);
  return keys.map((row) => row.key);
}
