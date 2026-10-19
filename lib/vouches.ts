/**
 * "I ate here" vouches (spec §2.2, §2.6, §4, §5.2): the one service behind the
 * web route and, later, the member MCP.
 *
 * A vouch is upserted (one per member and place, the latest counts), logged
 * as a `contributions` row and followed by `recomputeTrust` in the same
 * request. Anyone signed in can vouch, but a vouch only counts once its
 * weight is above 0 (for example, the account is 24 hours old): a counted
 * vouch is accepted at once and pays 3 points, and a weight-0 one stays
 * pending with pending points until a review accepts it. A vouch pays once
 * per place per member, ever, within the 100 points a day cap.
 */
import { sql } from "drizzle-orm";
import { VOUCHES_PER_DAY, ipNetwork, pointsToGrant, type Channel, type VouchInput } from "@/lib/core/contributions";
import { flagVouches } from "@/lib/contribution-flags";
import { database } from "@/lib/db";
import { recomputeTrust, type TrustResult } from "@/lib/trust";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

const DAY_MS = 24 * 60 * 60 * 1000;

export type VouchSource = {
  channel: Channel;
  /** The request's IP; only its hashed network is stored. */
  ip: string;
  apiKeyId?: string | null;
};

export type VouchResult =
  | {
      ok: true;
      value: {
        contributionId: string;
        status: "accepted" | "pending";
        weight: number;
        /** Points granted by this vouch (0 when pending, paid before or capped). */
        points: number;
        trust: TrustResult;
      };
    }
  | { ok: false; status: 404 | 429; error: string };

/** SHA-256 of the IP's /24 (or /48), so cluster damping never sees the address. */
export async function hashNetwork(ip: string): Promise<string | null> {
  const network = ipNetwork(ip);
  if (!network) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vouch-network:${network}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Vouch for a place as `userId`, log the contribution, recompute trust and pay points. */
export async function vouchForPlace(
  userId: string,
  placeId: string,
  input: VouchInput,
  source: VouchSource,
  client: Client = database(),
  now = Date.now(),
): Promise<VouchResult> {
  const db = await client;
  const [place] = await db.all<{ city_slug: string }>(sql`
    SELECT city_slug FROM places WHERE id = ${placeId} AND listing_status = 'listed'
  `);
  if (!place) return { ok: false, status: 404, error: "That place could not be found." };
  const [recent] = await db.all<{ n: number }>(sql`
    SELECT count(*) AS n FROM contributions WHERE user_id = ${userId} AND kind = 'vouch' AND created_at > ${now - DAY_MS}
  `);
  if (Number(recent?.n ?? 0) >= VOUCHES_PER_DAY)
    return { ok: false, status: 429, error: "You’ve vouched for a lot of places today. Please try again tomorrow." };

  await db.run(sql`
    INSERT INTO vouches (user_id, place_id, ate_at, rating, note, created_at, updated_at)
    VALUES (${userId}, ${placeId}, ${input.ateAt}, ${input.rating}, ${input.note}, ${now}, ${now})
    ON CONFLICT (user_id, place_id) DO UPDATE SET
      ate_at = excluded.ate_at, rating = excluded.rating, note = excluded.note, updated_at = excluded.updated_at
  `);

  // One voice per member and place: a vouch still waiting for review is updated, not stacked.
  const ref = `${userId}:${placeId}`;
  const ipHash = await hashNetwork(source.ip);
  const [latest] = await db.all<{ id: string; status: string }>(sql`
    SELECT id, status FROM contributions WHERE kind = 'vouch' AND ref_table = 'vouches' AND ref_id = ${ref}
    ORDER BY created_at DESC LIMIT 1
  `);
  let contributionId: string;
  if (latest?.status === "pending") {
    contributionId = latest.id;
    await db.run(sql`
      UPDATE contributions SET channel = ${source.channel}, ip_hash = ${ipHash}, api_key_id = ${source.apiKeyId ?? null}
      WHERE id = ${contributionId}
    `);
  } else {
    contributionId = crypto.randomUUID();
    await db.run(sql`
      INSERT INTO contributions (id, user_id, kind, place_id, ref_table, ref_id, channel, status, weight, ip_hash, api_key_id, created_at)
      VALUES (${contributionId}, ${userId}, 'vouch', ${placeId}, 'vouches', ${ref}, ${source.channel}, 'pending', 0, ${ipHash},
        ${source.apiKeyId ?? null}, ${now})
    `);
  }

  const trust = await recomputeTrust(placeId, db, now);
  const weight = trust.weights[userId] ?? 0;
  const status = weight > 0 ? "accepted" : "pending";
  await db.run(sql`UPDATE contributions SET status = ${status}, weight = ${weight} WHERE id = ${contributionId}`);
  const points = await settlePoints(db, { userId, placeId, citySlug: place.city_slug, contributionId, accepted: status === "accepted" }, now);
  // Detection is advisory: even a queue failure must never undo a saved vouch.
  await flagVouches(userId, placeId, contributionId, trust, db, now).catch((error: unknown) => {
    console.error("Could not flag vouch contributions", error);
  });
  return { ok: true, value: { contributionId, status, weight, points, trust } };
}

/**
 * Write the vouch's points row: granted (capped) when accepted, pending when
 * not, and nothing once this place has paid this member before.
 */
async function settlePoints(
  db: DatabaseClient,
  vouch: { userId: string; placeId: string; citySlug: string; contributionId: string; accepted: boolean },
  now: number,
): Promise<number> {
  const day = new Date(now).toISOString().slice(0, 10);
  const [paid] = await db.all<{ paid: number; pending_id: string | null }>(sql`
    SELECT
      EXISTS (SELECT 1 FROM contribution_points WHERE user_id = ${vouch.userId} AND kind = 'vouch' AND place_id = ${vouch.placeId}
        AND status IN ('granted', 'revoked')) AS paid,
      (SELECT id FROM contribution_points WHERE contribution_id = ${vouch.contributionId} AND status = 'pending') AS pending_id
  `);
  const paidBefore = Number(paid?.paid ?? 0) === 1;
  const pendingId = paid?.pending_id ?? null;
  if (!vouch.accepted) {
    if (!paidBefore && !pendingId)
      await db.run(sql`
        INSERT INTO contribution_points (id, user_id, contribution_id, kind, place_id, city_slug, points, status, day, created_at)
        VALUES (${crypto.randomUUID()}, ${vouch.userId}, ${vouch.contributionId}, 'vouch', ${vouch.placeId}, ${vouch.citySlug},
          ${pointsToGrant("vouch", { points: 0, awards: 0 })}, 'pending', ${day}, ${now})
      `);
    return 0;
  }
  const [today] = await db.all<{ points: number; awards: number }>(sql`
    SELECT coalesce(sum(points), 0) AS points, coalesce(sum(kind = 'vouch'), 0) AS awards FROM contribution_points
    WHERE user_id = ${vouch.userId} AND day = ${day} AND status = 'granted'
  `);
  const points = pointsToGrant("vouch", { points: Number(today?.points ?? 0), awards: Number(today?.awards ?? 0) }, { paidBefore });
  if (pendingId) {
    if (points > 0)
      await db.run(sql`UPDATE contribution_points SET points = ${points}, status = 'granted', day = ${day} WHERE id = ${pendingId}`);
    else await db.run(sql`DELETE FROM contribution_points WHERE id = ${pendingId}`);
  } else if (points > 0) {
    await db.run(sql`
      INSERT INTO contribution_points (id, user_id, contribution_id, kind, place_id, city_slug, points, status, day, created_at)
      VALUES (${crypto.randomUUID()}, ${vouch.userId}, ${vouch.contributionId}, 'vouch', ${vouch.placeId}, ${vouch.citySlug},
        ${points}, 'granted', ${day}, ${now})
    `);
  }
  return points;
}

export type Voucher = { userId: string; handle: string | null; name: string; avatarKey: string | null };

/**
 * Who verified a place: every counted vouch (accepted, weight above 0, not suspended), most trusted first. `total`
 * counts them all; `people` names only those the viewer may see, the same rule as `visibleAuthor`: nothing across a
 * block, private accounts only to accepted followers, and always the viewer themselves.
 */
export async function placeVouchers(
  placeId: string,
  viewerId: string | null,
  client: Client = database(),
): Promise<{ total: number; people: Voucher[] }> {
  const db = await client;
  const visible = viewerId
    ? sql`(
        v.user_id = ${viewerId}
        OR (
          NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = v.user_id)
            OR (b.blocker_id = v.user_id AND b.blocked_id = ${viewerId}))
          AND (
            COALESCE(pr.is_private, 0) = 0
            OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.followee_id = v.user_id AND f.status = 'accepted')
          )
        )
      )`
    : sql`COALESCE(pr.is_private, 0) = 0`;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT v.user_id, pr.handle, pr.display_name, pr.avatar_key, u.name, ${visible} AS visible
    FROM vouches v
    JOIN "user" u ON u.id = v.user_id
    LEFT JOIN profiles pr ON pr.user_id = v.user_id
    JOIN contributions c ON c.id = (
      SELECT id FROM contributions
      WHERE kind = 'vouch' AND ref_table = 'vouches' AND ref_id = v.user_id || ':' || v.place_id
      ORDER BY created_at DESC LIMIT 1
    )
    WHERE v.place_id = ${placeId} AND c.status = 'accepted' AND c.weight > 0 AND pr.suspended_at IS NULL
    ORDER BY c.weight DESC, v.updated_at DESC
  `);
  const people = rows
    .filter((row) => Number(row.visible) === 1)
    .map((row) => ({
      userId: String(row.user_id),
      handle: (row.handle as string | null) ?? null,
      name: String(row.display_name ?? row.name ?? "Someone"),
      avatarKey: (row.avatar_key as string | null) ?? null,
    }));
  return { total: rows.length, people };
}
