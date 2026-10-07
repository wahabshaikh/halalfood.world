/**
 * Keeping public listings fresh after a moderator changes one.
 *
 * Listings are read through two caches:
 *
 *   1. `cachedRead` keeps search, city, count and discovery results in isolate
 *      memory and in a per-colo Cache API namespace for minutes.
 *   2. Workers Cache (`cache.enabled` in wrangler.jsonc) stores place, city,
 *      guide and sitemap documents for `s-maxage`, in front of the Worker.
 *
 * Neither layer can be cleared from one request: isolate memory belongs to
 * each isolate, and the Cache API namespace belongs to each colo. So every
 * listing read key carries a directory version. A moderator action writes a
 * new version row to `audit_log`, which every isolate reads at most once per
 * `VERSION_MEMO_MS`. Old keys are never read again and expire on their own.
 * Workers Cache documents are tagged and purged by tag from the same action.
 * Its purge is global and scoped to this Worker, so it needs no API token.
 */

import { sql } from "drizzle-orm";
import { database } from "@/lib/db";
import { cachedRead } from "./read-cache";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

/** The audit row that carries the version. One indexed read finds it. */
export const LISTING_VERSION_TARGET_TYPE = "listing";
export const LISTING_VERSION_TARGET_ID = "directory";
export const LISTING_VERSION_ACTION = "listing.changed";

/** How long an isolate trusts the version it read. */
export const VERSION_MEMO_MS = 5_000;

let memo: { value: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

async function readVersion(client?: DatabaseClient | Promise<DatabaseClient>): Promise<string> {
  try {
    const db = await (client ?? database());
    const rows = await db.all<{ v?: unknown }>(sql`
      SELECT max(created_at) AS v FROM audit_log
      WHERE target_type = ${LISTING_VERSION_TARGET_TYPE}
        AND target_id = ${LISTING_VERSION_TARGET_ID}
    `);
    const value = rows[0]?.v;
    return typeof value === "number" || typeof value === "string" ? String(value) : "0";
  } catch {
    // No database (tests, scripts) or a failed read: fall back to one shared
    // key. That is the behaviour before versions existed, not an error page.
    return "0";
  }
}

/** The current directory version, memoised briefly per isolate. */
export async function listingVersion(
  client?: DatabaseClient | Promise<DatabaseClient>,
): Promise<string> {
  const now = Date.now();
  if (memo && memo.expiresAt > now) return memo.value;
  if (!pending) {
    pending = readVersion(client)
      .then((value) => {
        memo = { value, expiresAt: Date.now() + VERSION_MEMO_MS };
        return value;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Test hook. */
export function resetListingVersionMemo() {
  memo = null;
  pending = null;
}

/** `cachedRead` under the current directory version. */
export async function listingCachedRead<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  client?: DatabaseClient | Promise<DatabaseClient>,
): Promise<T> {
  const version = await listingVersion(client);
  return cachedRead(`${key}:lv${version}`, ttlSeconds, load);
}

export type ListingChange = {
  actorUserId: string;
  change: string;
  placeId: string;
  citySlug: string | null;
};

/** Cache-Tag values for one place. */
export function placeCacheTags(input: { placeId: string; citySlug: string | null }): string[] {
  const tags = [`place-${input.placeId}`, "cities", "guides", "sitemaps"];
  if (input.citySlug) tags.push(`city-${input.citySlug}`);
  return tags;
}

type PurgeResult = { success?: boolean; errors?: unknown[] };
type WorkersCacheApi = { purge?: (options: { tags: string[] }) => Promise<PurgeResult> };

/** Purge Workers Cache documents by tag. False when it was not possible. */
export async function purgeDocumentTags(tags: string[]): Promise<boolean> {
  if (!tags.length) return true;
  try {
    const workers = (await import("cloudflare:workers")) as { cache?: WorkersCacheApi };
    if (typeof workers.cache?.purge !== "function") return false;
    const result = await workers.cache.purge({ tags });
    if (result?.success === false) {
      console.warn("listing cache purge was refused", JSON.stringify(result.errors ?? []));
      return false;
    }
    return true;
  } catch (error) {
    console.warn("listing cache purge failed", error instanceof Error ? error.name : "error");
    return false;
  }
}

/**
 * Record that public listings changed, so every cached listing read moves to
 * a new key, then purge the place's documents. Call it after the change has
 * committed. The version row is written first: if the purge fails, documents
 * still expire within their `s-maxage`, and every data read is already fresh.
 */
export async function publishListingChange(
  input: ListingChange,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<{ purged: boolean }> {
  const db = await client;
  // Versions only move forward, even if this isolate's clock is behind the
  // one that wrote the last version.
  const previous = Number(await readVersion(db)) || 0;
  const now = Math.max(Date.now(), previous + 1);
  await db.run(sql`
    INSERT INTO audit_log (
      id, actor_user_id, action, target_type, target_id, reason,
      before_value, after_value, created_at
    ) VALUES (
      ${crypto.randomUUID()}, ${input.actorUserId}, ${LISTING_VERSION_ACTION},
      ${LISTING_VERSION_TARGET_TYPE}, ${LISTING_VERSION_TARGET_ID}, NULL,
      NULL, ${JSON.stringify({ change: input.change, placeId: input.placeId, citySlug: input.citySlug })},
      ${now}
    )
  `);
  // This isolate sees the change at once; others within VERSION_MEMO_MS.
  memo = { value: String(now), expiresAt: now + VERSION_MEMO_MS };
  const purged = await purgeDocumentTags(placeCacheTags(input));
  return { purged };
}
