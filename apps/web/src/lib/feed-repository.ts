/**
 * D1 access for the friends feed, visit pages, likes and comments.
 *
 * The feed is assembled when it is read: one `feed_events` row per shared visit
 * is matched against the people the viewer follows. Every read applies the same
 * three filters, in the query where it can and in `hidesFromViewer` where the
 * halal data has to be derived first:
 *
 * - blocks in either direction hide the person entirely,
 * - a private visit or a private account is never shown to anyone else,
 * - a place that breaks the viewer's own dietary standard is left out.
 *
 * Nothing here writes to halal evidence. A like, a comment or a follower is
 * taste; only dated, moderated evidence moves a status.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";
import type { DishVerdict, Verdict } from "@halalfood/core/check-in";
import {
  canViewVisit,
  decodeFeedCursor,
  encodeFeedCursor,
  FEED_PAGE_SIZE,
  type VisitAudience,
} from "@halalfood/core/feed";
import {
  deriveHalalAssessment,
  isRelationship,
  STATUS_COPY,
  type HalalTaxonomyStatus,
} from "@halalfood/core/halal-taxonomy";
import { mapPlaceFacts } from "@halalfood/core/place-facts";
import {
  evaluateSuitability,
  type UserPreferences,
} from "@halalfood/core/user-preferences";
import { listApprovedEvidenceByPlace } from "./halal-verifications";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type HalalCheckRow = {
  /** Pending until a moderator approves it. Rejected checks are never shown. */
  status: "pending" | "approved";
  certificate: "seen" | "not-seen" | "unsure" | null;
  alcohol: "none" | "served" | "unsure" | null;
  meat: "hand" | "machine" | "unsure" | null;
};

export type FeedCard = {
  eventId: string | null;
  visitId: string;
  /** When the visit was shared. */
  createdAt: number;
  visitedAt: number;
  author: {
    handle: string | null;
    displayName: string | null;
    isYou: boolean;
  };
  place: {
    id: string;
    name: string;
    citySlug: string;
    address: string;
    /** The place's own status today, from approved evidence, never from likes. */
    status: HalalTaxonomyStatus;
    statusLabel: string;
  };
  verdict: Verdict | null;
  note: string | null;
  dishes: Array<{ name: string; verdict: DishVerdict }>;
  verified: boolean;
  disclosureLabel: string | null;
  /** The diner's own observation, labelled as such and never as the place's status. */
  halalCheck: HalalCheckRow | null;
  likes: number;
  comments: number;
  liked: boolean;
};

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

const VERDICT_VALUES: readonly string[] = ["disliked", "okay", "liked", "favourite"];
const DISH_VERDICT_VALUES: readonly string[] = ["order-again", "fine", "avoid"];

function parseDishes(value: unknown): FeedCard["dishes"] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) =>
      item &&
      typeof item.name === "string" &&
      DISH_VERDICT_VALUES.includes(item.verdict)
        ? [{ name: item.name, verdict: item.verdict as DishVerdict }]
        : [],
    );
  } catch {
    return [];
  }
}

function halalCheckOf(row: Record<string, unknown>): HalalCheckRow | null {
  if (row.halal_status !== "pending" && row.halal_status !== "approved") return null;
  const pick = <T extends string>(value: unknown, allowed: readonly T[]) =>
    allowed.includes(value as T) ? (value as T) : null;
  const check: HalalCheckRow = {
    status: row.halal_status,
    certificate: pick(row.certificate, ["seen", "not-seen", "unsure"] as const),
    alcohol: pick(row.alcohol, ["none", "served", "unsure"] as const),
    meat: pick(row.meat, ["hand", "machine", "unsure"] as const),
  };
  return check.certificate || check.alcohol || check.meat ? check : null;
}

/** The place's status and the diner's standard, derived for a page of places. */
async function assessPlaces(
  placeIds: readonly string[],
  client: Client,
): Promise<
  Map<
    string,
    {
      status: HalalTaxonomyStatus;
      evaluate: (preferences: UserPreferences) => boolean;
    }
  >
> {
  const unique = [...new Set(placeIds)];
  const result = new Map<
    string,
    { status: HalalTaxonomyStatus; evaluate: (p: UserPreferences) => boolean }
  >();
  if (!unique.length) return result;
  const db = await client;
  const now = Date.now();
  const [evidence, factRows] = await Promise.all([
    listApprovedEvidenceByPlace(unique, db),
    db.all<Record<string, unknown>>(sql`
      SELECT * FROM place_facts WHERE place_id IN (${idList(unique)})
    `),
  ]);
  const factsByPlace = new Map(
    factRows.map((row) => [String(row.place_id), row] as const),
  );
  for (const placeId of unique) {
    const assessment = deriveHalalAssessment(evidence.get(placeId) ?? [], now);
    const facts = mapPlaceFacts(placeId, factsByPlace.get(placeId) ?? null);
    result.set(placeId, {
      status: assessment.status,
      evaluate: (preferences) =>
        evaluateSuitability(preferences, assessment, facts, now).meets,
    });
  }
  return result;
}

const CARD_COLUMNS = sql`
  v.id AS visit_id, v.user_id, v.visited_at,
  v.verification_method, v.verification_confidence,
  c.verdict, c.note, c.incentivized, c.relationship, c.created_at AS shared_at,
  p.id AS place_id, p.name AS place_name, p.city_slug, p.street_address,
  pr.handle, pr.display_name,
  hv.status AS halal_status, a.certificate, a.alcohol, a.meat,
  (SELECT COUNT(*) FROM reactions AS r WHERE r.visit_id = v.id) AS like_count,
  (SELECT COUNT(*) FROM comments AS cm WHERE cm.visit_id = v.id AND cm.status = 'visible') AS comment_count,
  COALESCE((
    SELECT json_group_array(json_object('name', d.dish_name, 'verdict', d.verdict))
    FROM place_check_in_dishes AS d WHERE d.visit_id = v.id
  ), '[]') AS dishes
`;

const CARD_JOINS = sql`
  FROM place_visits AS v
  INNER JOIN place_check_ins AS c ON c.visit_id = v.id
  INNER JOIN places AS p ON p.id = v.place_id
  LEFT JOIN user_profiles AS pr ON pr.user_id = v.user_id
  LEFT JOIN place_halal_verifications AS hv ON hv.id = c.halal_verification_id
  LEFT JOIN place_halal_check_answers AS a ON a.verification_id = hv.id
`;

function mapCard(
  row: Record<string, unknown>,
  viewerId: string | null,
  status: HalalTaxonomyStatus,
  extra: { eventId: string | null; liked: boolean },
): FeedCard {
  const incentivized = row.incentivized === 1 || row.incentivized === true;
  const relationship = isRelationship(row.relationship) ? row.relationship : "none";
  return {
    eventId: extra.eventId,
    visitId: String(row.visit_id),
    createdAt: num(row.shared_at),
    visitedAt: num(row.visited_at),
    author: {
      handle: text(row.handle),
      displayName: text(row.display_name),
      isYou: viewerId !== null && row.user_id === viewerId,
    },
    place: {
      id: String(row.place_id),
      name: String(row.place_name ?? ""),
      citySlug: String(row.city_slug ?? ""),
      address: String(row.street_address ?? ""),
      status,
      statusLabel: STATUS_COPY[status].label,
    },
    verdict: VERDICT_VALUES.includes(row.verdict as string)
      ? (row.verdict as Verdict)
      : null,
    note: text(row.note),
    dishes: parseDishes(row.dishes),
    verified:
      row.verification_method !== "none" && row.verification_confidence !== "none",
    disclosureLabel: incentivized
      ? "Rewarded visit"
      : relationship !== "none"
        ? "Connected to this restaurant"
        : null,
    halalCheck: halalCheckOf(row),
    likes: num(row.like_count),
    comments: num(row.comment_count),
    liked: extra.liked,
  };
}

async function likedVisitIds(
  viewerId: string | null,
  visitIds: readonly string[],
  client: Client,
): Promise<Set<string>> {
  if (!viewerId || !visitIds.length) return new Set();
  const db = await client;
  const rows = await db.all<{ visit_id: string }>(sql`
    SELECT visit_id FROM reactions
    WHERE user_id = ${viewerId} AND visit_id IN (${idList(visitIds)})
  `);
  return new Set(rows.map((row) => row.visit_id));
}

export type FeedPage = {
  cards: FeedCard[];
  nextCursor: string | null;
  /** Friends' visits left out because the place fails the viewer's own standard. */
  hiddenByStandard: number;
};

const FEED_BATCH = 40;
const FEED_MAX_BATCHES = 3;

/**
 * The friends feed: the viewer's own shared visits and those of everyone they
 * follow, newest first, minus anything that fails the viewer's own standard.
 * Filtering happens after the read, so a page is filled from up to three
 * batches and the cursor always points at the last row actually consumed.
 */
export async function listFriendsFeed(
  input: {
    viewerId: string;
    preferences: UserPreferences;
    cursor?: string | null;
    limit?: number;
  },
  client: Client = database(),
): Promise<FeedPage> {
  const db = await client;
  const limit = Math.min(Math.max(input.limit ?? FEED_PAGE_SIZE, 1), 50);
  let cursor = decodeFeedCursor(input.cursor ?? null);
  const cards: FeedCard[] = [];
  let hiddenByStandard = 0;
  let exhausted = false;

  for (let round = 0; round < FEED_MAX_BATCHES && cards.length < limit; round += 1) {
    const cursorFilter = cursor
      ? sql`AND (e.created_at < ${cursor.createdAt}
          OR (e.created_at = ${cursor.createdAt} AND e.id < ${cursor.id}))`
      : sql``;
    const events = await db.all<Record<string, unknown>>(sql`
      SELECT e.id AS event_id, e.created_at AS event_created_at, e.visit_id
      FROM feed_events AS e
      INNER JOIN place_visits AS v ON v.id = e.visit_id
      LEFT JOIN user_preferences AS up ON up.user_id = e.actor_id
      WHERE (
          e.actor_id = ${input.viewerId}
          OR (
            EXISTS (
              SELECT 1 FROM follows AS f
              WHERE f.follower_id = ${input.viewerId}
                AND f.followee_id = e.actor_id AND f.status = 'accepted'
            )
            AND v.visibility = 'public'
            AND COALESCE(up.visibility_visits, 'public') = 'public'
            AND NOT EXISTS (
              SELECT 1 FROM blocks AS b
              WHERE (b.blocker_id = ${input.viewerId} AND b.blocked_id = e.actor_id)
                 OR (b.blocker_id = e.actor_id AND b.blocked_id = ${input.viewerId})
            )
          )
        )
        ${cursorFilter}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${FEED_BATCH}
    `);
    if (events.length < FEED_BATCH) exhausted = true;
    if (!events.length) break;

    const visitIds = events.map((event) => String(event.visit_id));
    const [rows, liked] = await Promise.all([
      db.all<Record<string, unknown>>(sql`
        SELECT ${CARD_COLUMNS} ${CARD_JOINS}
        WHERE v.id IN (${idList(visitIds)})
      `),
      likedVisitIds(input.viewerId, visitIds, db),
    ]);
    const assessed = await assessPlaces(
      rows.map((row) => String(row.place_id)),
      db,
    );
    const byVisit = new Map(rows.map((row) => [String(row.visit_id), row] as const));

    for (const event of events) {
      const eventCursor = {
        createdAt: num(event.event_created_at),
        id: String(event.event_id),
      };
      const row = byVisit.get(String(event.visit_id));
      if (row) {
        const place = assessed.get(String(row.place_id));
        const isOwn = row.user_id === input.viewerId;
        if (place && (isOwn || place.evaluate(input.preferences))) {
          cards.push(
            mapCard(row, input.viewerId, place.status, {
              eventId: eventCursor.id,
              liked: liked.has(String(row.visit_id)),
            }),
          );
        } else if (place) hiddenByStandard += 1;
      }
      cursor = eventCursor;
      if (cards.length >= limit) {
        // Anything left in this batch has not been consumed yet.
        exhausted = false;
        break;
      }
    }
  }

  return {
    cards,
    nextCursor: exhausted || !cursor ? null : encodeFeedCursor(cursor),
    hiddenByStandard,
  };
}

export type VisitAccess = {
  visitId: string;
  ownerId: string;
  placeId: string;
  audience: VisitAudience;
};

/** Who owns a visit and whether this viewer may see it. Null when it does not exist. */
export async function getVisitAccess(
  visitId: string,
  viewerId: string | null,
  client: Client = database(),
): Promise<VisitAccess | null> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      v.id, v.user_id, v.place_id, v.visibility,
      COALESCE(up.visibility_visits, 'public') AS owner_visibility,
      EXISTS (
        SELECT 1 FROM blocks AS b
        WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = v.user_id)
           OR (b.blocker_id = v.user_id AND b.blocked_id = ${viewerId})
      ) AS blocked
    FROM place_visits AS v
    INNER JOIN place_check_ins AS c ON c.visit_id = v.id
    LEFT JOIN user_preferences AS up ON up.user_id = v.user_id
    WHERE v.id = ${visitId}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    visitId: String(row.id),
    ownerId: String(row.user_id),
    placeId: String(row.place_id),
    audience: {
      viewerId,
      ownerId: String(row.user_id),
      visitVisibility: row.visibility === "private" ? "private" : "public",
      ownerVisitsVisibility: row.owner_visibility === "private" ? "private" : "public",
      blocked: row.blocked === 1 || row.blocked === true,
    },
  };
}

/** One visit as a card, or null when it is missing or the viewer cannot see it. */
export async function getVisitCard(
  visitId: string,
  viewerId: string | null,
  client: Client = database(),
): Promise<FeedCard | null> {
  const db = await client;
  const access = await getVisitAccess(visitId, viewerId, db);
  if (!access || !canViewVisit(access.audience)) return null;
  const [rows, liked] = await Promise.all([
    db.all<Record<string, unknown>>(sql`
      SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE v.id = ${visitId} LIMIT 1
    `),
    likedVisitIds(viewerId, [visitId], db),
  ]);
  const row = rows[0];
  if (!row) return null;
  const assessed = await assessPlaces([String(row.place_id)], db);
  const status = assessed.get(String(row.place_id))?.status ?? "unverified";
  return mapCard(row, viewerId, status, { eventId: null, liked: liked.has(visitId) });
}

/* ----------------------------------------------------------------- likes -- */

export async function setLike(
  visitId: string,
  userId: string,
  liked: boolean,
  client: Client = database(),
): Promise<number> {
  const db = await client;
  if (liked)
    await db.run(sql`
      INSERT INTO reactions (visit_id, user_id, kind, created_at)
      VALUES (${visitId}, ${userId}, 'like', ${Date.now()})
      ON CONFLICT(visit_id, user_id) DO NOTHING
    `);
  else
    await db.run(sql`
      DELETE FROM reactions WHERE visit_id = ${visitId} AND user_id = ${userId}
    `);
  const rows = await db.all<{ total: unknown }>(sql`
    SELECT COUNT(*) AS total FROM reactions WHERE visit_id = ${visitId}
  `);
  return num(rows[0]?.total);
}

/* -------------------------------------------------------------- comments -- */

export type CommentView = {
  id: string;
  visitId: string;
  body: string;
  createdAt: number;
  author: { handle: string | null; displayName: string | null; isYou: boolean };
  /** The viewer wrote it, or owns the visit, so they may remove it. */
  canDelete: boolean;
};

function mapComment(
  row: Record<string, unknown>,
  viewerId: string | null,
  visitOwnerId: string,
): CommentView {
  const isYou = viewerId !== null && row.user_id === viewerId;
  return {
    id: String(row.id),
    visitId: String(row.visit_id),
    body: String(row.body ?? ""),
    createdAt: num(row.created_at),
    author: { handle: text(row.handle), displayName: text(row.display_name), isYou },
    canDelete: isYou || (viewerId !== null && viewerId === visitOwnerId),
  };
}

export async function listComments(
  visitId: string,
  viewerId: string | null,
  visitOwnerId: string,
  client: Client = database(),
): Promise<CommentView[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT cm.id, cm.visit_id, cm.user_id, cm.body, cm.created_at,
      pr.handle, pr.display_name
    FROM comments AS cm
    LEFT JOIN user_profiles AS pr ON pr.user_id = cm.user_id
    WHERE cm.visit_id = ${visitId} AND cm.status = 'visible'
      AND NOT EXISTS (
        SELECT 1 FROM blocks AS b
        WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = cm.user_id)
           OR (b.blocker_id = cm.user_id AND b.blocked_id = ${viewerId})
      )
    ORDER BY cm.created_at ASC, cm.rowid ASC
    LIMIT 200
  `);
  return rows.map((row) => mapComment(row, viewerId, visitOwnerId));
}

export async function addComment(
  visitId: string,
  userId: string,
  body: string,
  visitOwnerId: string,
  client: Client = database(),
): Promise<CommentView> {
  const db = await client;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.run(sql`
    INSERT INTO comments (id, visit_id, user_id, body, status, created_at)
    VALUES (${id}, ${visitId}, ${userId}, ${body}, 'visible', ${now})
  `);
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT pr.handle, pr.display_name FROM user_profiles AS pr WHERE pr.user_id = ${userId}
  `);
  return mapComment(
    {
      id,
      visit_id: visitId,
      user_id: userId,
      body,
      created_at: now,
      handle: rows[0]?.handle,
      display_name: rows[0]?.display_name,
    },
    userId,
    visitOwnerId,
  );
}

export type CommentRecord = { id: string; visitId: string; authorId: string };

export async function getComment(
  commentId: string,
  client: Client = database(),
): Promise<CommentRecord | null> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, visit_id, user_id FROM comments
    WHERE id = ${commentId} AND status = 'visible' LIMIT 1
  `);
  const row = rows[0];
  return row
    ? { id: String(row.id), visitId: String(row.visit_id), authorId: String(row.user_id) }
    : null;
}

export async function deleteComment(
  commentId: string,
  client: Client = database(),
): Promise<void> {
  const db = await client;
  await db.run(sql`DELETE FROM comments WHERE id = ${commentId}`);
}
