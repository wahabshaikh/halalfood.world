/**
 * The social layer on the map: which of the viewer's friends have been to the
 * places on screen, for friend-avatar pins and one-line labels.
 *
 * A friend's visit is shown on the same terms as the friends feed: the visit
 * must have been shared, both it and the friend's visits must be public, and a
 * block in either direction hides it. None of it touches halal evidence; the pin
 * tint still comes from the place's own status.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";
import { listedVisitPlace } from "./visits";
import { avatarUrl } from "@halalfood/core/social";
import { VERDICTS, type Verdict } from "@halalfood/core/check-in";
import { pinFriends, socialLabel, type FriendVisit } from "@halalfood/core/map-social";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type PinSocial = {
  /** Up to three faces, favourites first. */
  friends: FriendVisit[];
  /** How many friends in all have been. */
  friendCount: number;
  /** "Zaid loved this", "On your want-to-try". Null when there is nothing to say. */
  label: string | null;
  /** The viewer's own relationship to the place. */
  you: "been" | "want" | null;
};

/** Most recent shared friend visits considered per request. */
const FRIEND_EVENT_LIMIT = 500;
const OWN_LIMIT = 1000;

function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

/**
 * Social details for the given places. Places nobody in the viewer's circle has
 * touched are simply absent, so the result stays small.
 */
export async function mapSocialFor(
  viewerId: string,
  placeIds: readonly string[],
  client: Client = database(),
): Promise<Record<string, PinSocial>> {
  if (!placeIds.length) return {};
  const wanted = new Set(placeIds);
  const db = await client;
  const [friendRows, beenRows, wantRows] = await Promise.all([
    db.all<Record<string, unknown>>(sql`
      SELECT e.place_id, e.actor_id, e.created_at, c.verdict,
        pr.handle, pr.display_name, pr.avatar_key
      FROM follows AS f
      INNER JOIN feed_events AS e ON e.actor_id = f.followee_id
      INNER JOIN place_visits AS v ON v.id = e.visit_id
      INNER JOIN user_profiles AS pr ON pr.user_id = e.actor_id
      LEFT JOIN user_preferences AS up ON up.user_id = e.actor_id
      LEFT JOIN place_check_ins AS c ON c.visit_id = v.id
      WHERE f.follower_id = ${viewerId} AND f.status = 'accepted'
        AND ${listedVisitPlace("v")}
        AND v.visibility = 'public'
        AND COALESCE(up.visibility_visits, 'public') = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks AS b
          WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = e.actor_id)
             OR (b.blocker_id = e.actor_id AND b.blocked_id = ${viewerId})
        )
      ORDER BY e.created_at DESC
      LIMIT ${FRIEND_EVENT_LIMIT}
    `),
    // visit-visibility: owner-only (the viewer's own "been here" pins).
    db.all<{ place_id: string }>(sql`
      SELECT DISTINCT place_id FROM place_visits WHERE user_id = ${viewerId} LIMIT ${OWN_LIMIT}
    `),
    db.all<{ place_id: string }>(sql`
      SELECT place_id FROM saved_places WHERE user_id = ${viewerId} LIMIT ${OWN_LIMIT}
    `),
  ]);

  // The newest visit per friend per place is the one that counts.
  const byPlace = new Map<string, Map<string, FriendVisit>>();
  for (const row of friendRows) {
    const placeId = String(row.place_id);
    if (!wanted.has(placeId)) continue;
    const actorId = String(row.actor_id);
    const people = byPlace.get(placeId) ?? new Map<string, FriendVisit>();
    if (!people.has(actorId)) {
      const handle = String(row.handle ?? "");
      people.set(actorId, {
        handle,
        displayName: typeof row.display_name === "string" ? row.display_name : null,
        avatarUrl: avatarUrl(handle, typeof row.avatar_key === "string" ? row.avatar_key : null),
        verdict: isVerdict(row.verdict) ? row.verdict : null,
        visitedAt: Number(row.created_at) || 0,
      });
    }
    byPlace.set(placeId, people);
  }
  const been = new Set(beenRows.map((row) => row.place_id));
  const want = new Set(wantRows.map((row) => row.place_id));

  const result: Record<string, PinSocial> = {};
  for (const placeId of wanted) {
    const friends = [...(byPlace.get(placeId)?.values() ?? [])];
    const you = been.has(placeId) ? "been" : want.has(placeId) ? "want" : null;
    if (!friends.length && !you) continue;
    result[placeId] = {
      friends: pinFriends(friends),
      friendCount: friends.length,
      label: socialLabel(friends, you === "want") ?? (you === "been" ? "You have been" : null),
      you,
    };
  }
  return result;
}
