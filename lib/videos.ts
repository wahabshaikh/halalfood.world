/**
 * Video paste (spec §5.1): a member pastes a YouTube link and picks the places
 * it shows; the one service behind `/api/videos` and, later, the member MCP.
 *
 * The first paste of a video fetches oEmbed (free, no key) and, only when
 * YOUTUBE_API_KEY is set, one `videos.list` and one `channels.list` call
 * (2 of the 10,000 daily units). Everything is cached in `video_submissions`
 * for 30 days, so later pastes fetch nothing. The channel becomes a creator
 * profile through Scout's `upsertCreator` (source 'member') plus its socials
 * in `creator_links`.
 *
 * Each picked place is a `contributions` row (kind 'video'). New and
 * restricted members' picks wait in the /admin Videos queue; everyone else's
 * publish at once as `creator_verifications` through Scout's
 * `addVerification`, which recomputes the place's trust. Points (5, plus 2
 * per place the submission newly published) are paid only on publish, with the base paid once
 * per member and video, within the 100 points a day cap. No server-side LLM.
 */
import { sql } from "drizzle-orm";
import { DAILY_POINTS_CAP, POINTS_PER_VIDEO_PLACE, POINT_RULES } from "@/lib/core/contributions";
import { youtubeWatchUrl } from "@/lib/core/creators";
import { memberTrust, parseTier, TIER_WEIGHT, type Tier } from "@/lib/core/trust";
import {
  VIDEOS_PER_DAY,
  channelFromDataApi,
  creatorLinksFromText,
  isMetaFresh,
  metaFromOEmbed,
  needsReview,
  videoFromDataApi,
  videoStatus,
  type VideoMeta,
  type VideoStatus,
} from "@/lib/core/videos";
import { database } from "@/lib/db";
import { readWorkerEnv } from "@/lib/worker-env";
import { matchPlacesForCaption, type MatchedPlace } from "@/lib/media-match-repository";
import { findCreator, upsertCreator } from "@/lib/scout/creators";
import type { ScoutDeps } from "@/lib/scout/deps";
import { addVerification } from "@/lib/scout/verifications";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

const DAY_MS = 24 * 60 * 60 * 1000;
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

export type VideoDeps = {
  db: DatabaseClient;
  /** No trailing slash, for creator links. */
  origin: string;
  now: () => number;
  /** YOUTUBE_API_KEY, or null to read oEmbed only. */
  youtubeKey: string | null;
  fetcher?: typeof fetch;
};

type Failure = { ok: false; status: 400 | 404 | 409 | 429 | 502; error: string };

type SubmissionRow = {
  id: string;
  video_id: string;
  url: string;
  status: VideoStatus;
  creator_user_id: string | null;
  meta: string;
  place_ids: string;
  updated_at: number;
};

export type VideoCreator = { userId: string; handle: string; name: string | null; avatarUrl: string | null };

export type PastedVideo = {
  id: string;
  videoId: string;
  url: string;
  status: VideoStatus;
  meta: VideoMeta;
  creator: VideoCreator | null;
  suggestions: MatchedPlace[];
};

function parseMeta(value: string): VideoMeta | null {
  try {
    const meta = JSON.parse(value) as VideoMeta;
    return typeof meta?.fetchedAt === "number" ? meta : null;
  } catch {
    return null;
  }
}

function parseIds(value: string): string[] {
  try {
    const ids = JSON.parse(value);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

async function getJson(fetcher: typeof fetch, url: string): Promise<unknown | null> {
  try {
    const response = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * Read a video's metadata: oEmbed, then at most one `videos.list` and one
 * `channels.list` call. Null when oEmbed can't read it (private or removed).
 * A Data API failure keeps and caches the oEmbed fields too, so later
 * submitters cannot repeatedly spend quota on an unavailable API.
 */
export async function fetchVideoMeta(videoId: string, youtubeKey: string | null, fetcher: typeof fetch, now: number): Promise<VideoMeta | null> {
  const url = youtubeWatchUrl(videoId);
  const oembed = await getJson(fetcher, `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  if (!oembed) return null;
  const meta: VideoMeta = { ...metaFromOEmbed(oembed), description: null, publishedAt: null, channel: null, fetchedAt: now };
  if (!youtubeKey) return meta;
  const key = encodeURIComponent(youtubeKey);
  const video = videoFromDataApi(
    await getJson(fetcher, `${YOUTUBE_API}/videos?part=snippet&id=${videoId}&fields=items(snippet(channelId,description,publishedAt))&key=${key}`),
  );
  if (!video) return meta;
  const channel = channelFromDataApi(
    await getJson(
      fetcher,
      `${YOUTUBE_API}/channels?part=snippet,statistics,brandingSettings&id=${video.channelId}` +
        `&fields=items(id,snippet(title,description,customUrl,thumbnails),statistics(subscriberCount),brandingSettings(image(bannerExternalUrl)))&key=${key}`,
    ),
  );
  return { ...meta, description: video.description, publishedAt: video.publishedAt, channel, fetchedAt: now };
}

/** Deps for a request: the database, its origin and YOUTUBE_API_KEY. */
export async function videoDeps(request: Request): Promise<VideoDeps> {
  return {
    db: await database(),
    origin: new URL(request.url).origin,
    now: Date.now,
    youtubeKey: (await readWorkerEnv("YOUTUBE_API_KEY")) || null,
  };
}

function scoutDeps(deps: VideoDeps): ScoutDeps {
  return { db: deps.db, origin: deps.origin, now: deps.now };
}

/**
 * The creator behind the video: created or refreshed from the channel when
 * the Data API named it, else an existing creator matched by oEmbed's handle.
 */
async function resolveCreator(deps: VideoDeps, meta: VideoMeta): Promise<string | null> {
  const channel = meta.channel;
  if (channel) {
    const handle = channel.handle ?? meta.authorHandle ?? channel.channelId.toLowerCase();
    if (handle) {
      await upsertCreator(
        scoutDeps(deps),
        {
          handle,
          channel_id: channel.channelId,
          display_name: channel.title ?? meta.authorName ?? handle,
          bio: channel.description,
          avatar_url: channel.avatarUrl,
          banner_url: channel.bannerUrl,
          subscriber_count: channel.subscriberCount,
        },
        "member",
      );
    }
    const creator = await findCreator(scoutDeps(deps), channel.channelId);
    if (!creator) return null;
    const now = deps.now();
    const links = [
      { kind: "youtube", url: channel.handle ? `https://www.youtube.com/@${channel.handle}` : `https://www.youtube.com/channel/${channel.channelId}` },
      ...creatorLinksFromText(channel.description),
    ];
    for (const link of links)
      await deps.db.run(sql`
        INSERT INTO creator_links (creator_user_id, kind, url, source, created_at)
        VALUES (${creator.user_id}, ${link.kind}, ${link.url}, 'youtube_about', ${now})
        ON CONFLICT (creator_user_id, kind) DO NOTHING
      `);
    return creator.user_id;
  }
  const creator = meta.authorHandle ? await findCreator(scoutDeps(deps), meta.authorHandle) : null;
  return creator?.user_id ?? null;
}

async function creatorSummary(db: DatabaseClient, userId: string | null): Promise<VideoCreator | null> {
  if (!userId) return null;
  const [row] = await db.all<{ handle: string; display_name: string | null; avatar_url: string | null }>(sql`
    SELECT pr.handle, pr.display_name, cp.avatar_url FROM profiles pr
    LEFT JOIN creator_profiles cp ON cp.user_id = pr.user_id WHERE pr.user_id = ${userId}
  `);
  return row ? { userId, handle: row.handle, name: row.display_name, avatarUrl: row.avatar_url } : null;
}

async function submissionByVideo(db: DatabaseClient, videoId: string): Promise<SubmissionRow | null> {
  const [row] = await db.all<SubmissionRow>(sql`
    SELECT id, video_id, url, status, creator_user_id, meta, place_ids, updated_at FROM video_submissions
    WHERE platform = 'youtube' AND video_id = ${videoId}
  `);
  return row ?? null;
}

async function submissionById(db: DatabaseClient, id: string): Promise<SubmissionRow | null> {
  const [row] = await db.all<SubmissionRow>(sql`
    SELECT id, video_id, url, status, creator_user_id, meta, place_ids, updated_at FROM video_submissions WHERE id = ${id}
  `);
  return row ?? null;
}

/**
 * Paste a video: its cached row, or a new one from oEmbed and the Data API,
 * with its creator and places named in its title or description.
 */
export async function pasteVideo(userId: string, videoId: string, deps: VideoDeps): Promise<{ ok: true; value: PastedVideo } | Failure> {
  const { db } = deps;
  const now = deps.now();
  let row = await submissionByVideo(db, videoId);
  let meta = row ? parseMeta(row.meta) : null;
  let reservedId: string | null = null;
  if (!row) {
    const id = crypto.randomUUID();
    const [reserved] = await db.all<{ id: string }>(sql`
      INSERT INTO video_submissions (id, user_id, platform, video_id, url, status, created_at, updated_at)
      VALUES (${id}, ${userId}, 'youtube', ${videoId}, ${youtubeWatchUrl(videoId)}, 'fetched', ${now}, ${now})
      ON CONFLICT (platform, video_id) DO NOTHING RETURNING id
    `);
    if (!reserved) return { ok: false, status: 409, error: "That video is being fetched. Please try again shortly." };
    reservedId = reserved.id;
  } else if (!isMetaFresh(meta, now)) {
    if (now - row.updated_at < 60_000)
      return { ok: false, status: 409, error: "That video is being fetched. Please try again shortly." };
    const [reserved] = await db.all<{ id: string }>(sql`
      UPDATE video_submissions SET updated_at = ${now}
      WHERE id = ${row.id} AND updated_at = ${row.updated_at} RETURNING id
    `);
    if (!reserved) return { ok: false, status: 409, error: "That video is being fetched. Please try again shortly." };
  }
  if (!row || !isMetaFresh(meta, now)) {
    const fetched = await fetchVideoMeta(videoId, deps.youtubeKey, deps.fetcher ?? fetch, now);
    if (!fetched && !meta) {
      if (reservedId) await db.run(sql`DELETE FROM video_submissions WHERE id = ${reservedId}`);
      return { ok: false, status: 404, error: "We couldn’t read that video. Check it’s public and try again." };
    }
    if (fetched) meta = fetched;
    const creatorUserId = (await resolveCreator(deps, meta!)) ?? row?.creator_user_id ?? null;
    await db.run(sql`
      INSERT INTO video_submissions (id, user_id, platform, video_id, url, status, creator_user_id, meta, channel, created_at, updated_at)
      VALUES (${reservedId ?? crypto.randomUUID()}, ${userId}, 'youtube', ${videoId}, ${youtubeWatchUrl(videoId)}, 'fetched', ${creatorUserId},
        ${JSON.stringify(meta)}, 'web', ${now}, ${now})
      ON CONFLICT (platform, video_id) DO UPDATE SET meta = excluded.meta, creator_user_id = excluded.creator_user_id, updated_at = excluded.updated_at
    `);
    row = await submissionByVideo(db, videoId);
    if (!row) throw new Error("video submission was not written");
  }
  const caption = [meta!.title, meta!.description?.slice(0, 600)].filter(Boolean).join("\n");
  return {
    ok: true,
    value: {
      id: row.id,
      videoId,
      url: row.url,
      status: row.status,
      meta: meta!,
      creator: await creatorSummary(db, row.creator_user_id),
      suggestions: (await matchPlacesForCaption(caption, db)).slice(0, 5),
    },
  };
}

/**
 * The member's tier: their `member_trust` projection, or worked out from the
 * account and contribution record when there is none yet. A suspension wins.
 */
export async function memberTier(db: DatabaseClient, userId: string, now: number): Promise<Tier> {
  const [row] = await db.all<Record<string, number | string | null>>(sql`
    SELECT u.created_at, u.email_verified, pr.suspended_at, m.user_id AS moderator, cp.user_id AS creator, mt.tier,
      (SELECT count(*) FROM contributions WHERE user_id = u.id AND status = 'accepted') AS accepted,
      (SELECT count(DISTINCT place_id) FROM contributions WHERE user_id = u.id AND status = 'accepted') AS accepted_places,
      (SELECT count(*) FROM contributions WHERE user_id = u.id AND status = 'rejected') AS rejected,
      (SELECT count(*) FROM contributions WHERE user_id = u.id AND status = 'rejected' AND reviewed_at > ${now - 30 * DAY_MS}) AS rejected_30d
    FROM "user" u
    LEFT JOIN profiles pr ON pr.user_id = u.id
    LEFT JOIN moderators m ON m.user_id = u.id
    LEFT JOIN creator_profiles cp ON cp.user_id = u.id AND cp.claimed_at IS NOT NULL
    LEFT JOIN member_trust mt ON mt.user_id = u.id
    WHERE u.id = ${userId}
  `);
  if (!row || row.suspended_at !== null) return "restricted";
  const stored = parseTier(row.tier);
  if (stored) return stored;
  return memberTrust(
    {
      createdAt: Number(row.created_at),
      emailVerified: Number(row.email_verified) === 1,
      suspended: false,
      moderator: row.moderator !== null,
      creator: row.creator !== null,
      accepted: Number(row.accepted),
      acceptedPlaces: Number(row.accepted_places),
      rejected: Number(row.rejected),
      rejected30d: Number(row.rejected_30d),
      upheldReports90d: 0,
    },
    now,
  ).tier;
}

export type SubmitResult =
  | { ok: true; value: { status: "published" | "needs_review"; published: string[]; points: number } }
  | Failure;

/** Pick the places a pasted video shows: queued for review, or published at once. */
export async function submitVideoPlaces(userId: string, submissionId: string, placeIds: string[], deps: VideoDeps): Promise<SubmitResult> {
  const { db } = deps;
  const now = deps.now();
  const submission = await submissionById(db, submissionId);
  if (!submission) return { ok: false, status: 404, error: "That video could not be found. Paste it again." };
  if (!submission.creator_user_id)
    return { ok: false, status: 409, error: "We couldn’t tell whose channel this is, so it can’t verify places yet." };

  // One submission per video a day counts, however many times the member adds places to it.
  const [today] = await db.all<{ n: number }>(sql`
    SELECT count(DISTINCT ref_id) AS n FROM contributions
    WHERE user_id = ${userId} AND kind = 'video' AND ref_id != ${submissionId} AND created_at > ${now - DAY_MS}
  `);
  if (Number(today?.n ?? 0) >= VIDEOS_PER_DAY)
    return { ok: false, status: 429, error: "You’ve sent a lot of videos today. Please try again tomorrow." };

  const places = await db.all<{ id: string }>(sql`
    SELECT id FROM places WHERE listing_status = 'listed' AND id IN (${sql.join(placeIds.map((id) => sql`${id}`), sql`, `)})
  `);
  if (places.length !== placeIds.length) return { ok: false, status: 400, error: "One of those places could not be found." };

  const already = await db.all<{ place_id: string }>(sql`
    SELECT place_id FROM contributions
    WHERE user_id = ${userId} AND kind = 'video' AND ref_table = 'video_submissions' AND ref_id = ${submissionId}
      AND status IN ('pending', 'accepted')
  `);
  const sent = new Set(already.map((row) => row.place_id));
  const fresh = placeIds.filter((id) => !sent.has(id));
  if (!fresh.length) return { ok: false, status: 409, error: "You’ve already sent those places for this video." };

  const tier = await memberTier(db, userId, now);
  const contributions: { id: string; placeId: string }[] = [];
  for (const placeId of fresh) {
    const [added] = await db.all<{ id: string }>(sql`
      INSERT INTO contributions (id, user_id, kind, place_id, ref_table, ref_id, channel, status, weight, created_at)
      VALUES (${crypto.randomUUID()}, ${userId}, 'video', ${placeId}, 'video_submissions', ${submissionId}, 'web', 'pending',
        ${TIER_WEIGHT[tier]}, ${now})
      ON CONFLICT DO NOTHING RETURNING id
    `);
    if (added) contributions.push({ id: added.id, placeId });
  }
  if (!contributions.length) return { ok: false, status: 409, error: "You’ve already sent those places for this video." };
  if (needsReview(tier)) {
    await refreshStatus(db, submissionId, now);
    return { ok: true, value: { status: "needs_review", published: [], points: 0 } };
  }
  const result = await publish(deps, submission, userId, contributions, null);
  return { ok: true, value: { status: "published", ...result } };
}

/**
 * Publish pending picks as creator verifications, accept them, and pay the
 * member's points. A pick that can't publish (for example, the place was unlisted) is
 * rejected with the reason.
 */
async function publish(
  deps: VideoDeps,
  submission: SubmissionRow,
  userId: string,
  contributions: { id: string; placeId: string }[],
  reviewerId: string | null,
): Promise<{ published: string[]; points: number }> {
  const { db } = deps;
  const now = deps.now();
  const meta = parseMeta(submission.meta);
  const [channel] = await db.all<{ channel_id: string }>(sql`SELECT channel_id FROM creator_profiles WHERE user_id = ${submission.creator_user_id}`);
  const published: string[] = [];
  const accepted: { id: string; placeId: string }[] = [];
  for (const contribution of contributions) {
    const result = channel
      ? await addVerification(
          scoutDeps(deps),
          {
            creator: channel.channel_id,
            place_id: contribution.placeId,
            video_url: submission.url,
            date: meta?.publishedAt ?? undefined,
            title: meta?.title ?? undefined,
          },
          "member",
        )
      : ({ ok: false, message: "This video's creator has no channel on file." } as const);
    if (result.ok) {
      accepted.push(contribution);
      if (result.result === "created") published.push(contribution.placeId);
    }
    await db.run(sql`
      UPDATE contributions SET status = ${result.ok ? "accepted" : "rejected"}, reviewed_by = ${reviewerId}, reviewed_at = ${now},
        reason = ${result.ok ? null : result.message.slice(0, 300)}
      WHERE id = ${contribution.id}
    `);
  }
  const placeIds = [...new Set([...parseIds(submission.place_ids), ...accepted.map((item) => item.placeId)])];
  await db.run(sql`UPDATE video_submissions SET place_ids = ${JSON.stringify(placeIds)}, updated_at = ${now} WHERE id = ${submission.id}`);
  await refreshStatus(db, submission.id, now);
  const points = published.length ? await payPoints(db, userId, submission.id, accepted[0], published.length, now) : 0;
  return { published, points };
}

/** 5 + 2 per newly published place, with the base once per member and video, within the daily caps. */
async function payPoints(
  db: DatabaseClient,
  userId: string,
  submissionId: string,
  contribution: { id: string; placeId: string },
  placesPublished: number,
  now: number,
): Promise<number> {
  const day = new Date(now).toISOString().slice(0, 10);
  const [award] = await db.all<{ points: number }>(sql`
    INSERT INTO contribution_points (id, user_id, contribution_id, kind, place_id, city_slug, points, status, day, created_at)
    SELECT ${crypto.randomUUID()}, ${userId}, ${contribution.id}, 'video', ${contribution.placeId},
      (SELECT city_slug FROM places WHERE id = ${contribution.placeId}),
      min(${DAILY_POINTS_CAP} - today.total,
        ${POINTS_PER_VIDEO_PLACE * placesPublished} + CASE WHEN paid.already = 0 THEN ${POINT_RULES.video.points} ELSE 0 END),
      'granted', ${day}, ${now}
    FROM (SELECT coalesce(sum(points), 0) AS total FROM contribution_points
      WHERE user_id = ${userId} AND day = ${day} AND status = 'granted') today,
      (SELECT count(DISTINCT c.ref_id) AS n FROM contribution_points cp JOIN contributions c ON c.id = cp.contribution_id
        WHERE cp.user_id = ${userId} AND cp.kind = 'video' AND cp.day = ${day} AND cp.status = 'granted') awards,
      (SELECT EXISTS (SELECT 1 FROM contribution_points cp JOIN contributions c ON c.id = cp.contribution_id
        WHERE cp.user_id = ${userId} AND cp.kind = 'video' AND c.ref_id = ${submissionId}) AS already) paid
    WHERE today.total < ${DAILY_POINTS_CAP} AND (paid.already = 1 OR awards.n < ${POINT_RULES.video.perDay})
      AND NOT EXISTS (SELECT 1 FROM contribution_points WHERE contribution_id = ${contribution.id})
    RETURNING points
  `);
  return Number(award?.points ?? 0);
}

async function refreshStatus(db: DatabaseClient, submissionId: string, now: number): Promise<void> {
  const [state] = await db.all<{ published: number; pending: number; rejected: number }>(sql`
    SELECT
      (SELECT json_array_length(place_ids) FROM video_submissions WHERE id = ${submissionId}) AS published,
      (SELECT count(*) FROM contributions WHERE ref_table = 'video_submissions' AND ref_id = ${submissionId} AND status = 'pending') AS pending,
      (SELECT count(*) FROM contributions WHERE ref_table = 'video_submissions' AND ref_id = ${submissionId} AND status = 'rejected') AS rejected
  `);
  const status = videoStatus({ published: Number(state?.published ?? 0), pending: Number(state?.pending ?? 0), rejected: Number(state?.rejected ?? 0) });
  await db.run(sql`UPDATE video_submissions SET status = ${status}, updated_at = ${now} WHERE id = ${submissionId}`);
}

export type VideoQueueItem = {
  submissionId: string;
  userId: string;
  handle: string | null;
  url: string;
  title: string | null;
  thumbnailUrl: string | null;
  creatorHandle: string | null;
  places: { id: string; name: string }[];
  createdAt: number;
};

/** Video picks waiting on review, one item per member and video, oldest first. */
export async function listVideoQueue(client: DatabaseClient | Promise<DatabaseClient> = database()): Promise<VideoQueueItem[]> {
  const db = await client;
  const rows = await db.all<{
    ref_id: string;
    user_id: string;
    handle: string | null;
    url: string;
    meta: string;
    creator_handle: string | null;
    place_id: string;
    place_name: string;
    created_at: number;
  }>(sql`
    SELECT c.ref_id, c.user_id, pr.handle, vs.url, vs.meta, cpr.handle AS creator_handle, p.id AS place_id, p.name AS place_name, c.created_at
    FROM contributions c
    JOIN video_submissions vs ON vs.id = c.ref_id
    JOIN places p ON p.id = c.place_id
    LEFT JOIN profiles pr ON pr.user_id = c.user_id
    LEFT JOIN profiles cpr ON cpr.user_id = vs.creator_user_id
    WHERE c.kind = 'video' AND c.ref_table = 'video_submissions' AND c.status = 'pending'
    ORDER BY c.created_at
    LIMIT 200
  `);
  const items = new Map<string, VideoQueueItem>();
  for (const row of rows) {
    const key = `${row.ref_id}:${row.user_id}`;
    let item = items.get(key);
    if (!item) {
      const meta = parseMeta(row.meta);
      item = {
        submissionId: row.ref_id,
        userId: row.user_id,
        handle: row.handle,
        url: row.url,
        title: meta?.title ?? null,
        thumbnailUrl: meta?.thumbnailUrl ?? null,
        creatorHandle: row.creator_handle,
        places: [],
        createdAt: Number(row.created_at),
      };
      items.set(key, item);
    }
    item.places.push({ id: row.place_id, name: row.place_name });
  }
  return [...items.values()];
}

/** A moderator approves (publishes) or rejects one member's pending picks for a video. Audited. */
export async function reviewVideo(
  moderatorId: string,
  submissionId: string,
  userId: string,
  decision: "approve" | "reject",
  reason: string | null,
  deps: VideoDeps,
): Promise<{ ok: true; value: { published: string[]; points: number } } | Failure> {
  const { db } = deps;
  const now = deps.now();
  const submission = await submissionById(db, submissionId);
  const pending = submission
    ? await db.all<{ id: string; place_id: string }>(sql`
        SELECT id, place_id FROM contributions
        WHERE user_id = ${userId} AND kind = 'video' AND ref_table = 'video_submissions' AND ref_id = ${submissionId} AND status = 'pending'
      `)
    : [];
  if (!submission || !pending.length) return { ok: false, status: 404, error: "Nothing from this member is waiting on this video." };
  let result = { published: [] as string[], points: 0 };
  if (decision === "approve") {
    result = await publish(deps, submission, userId, pending.map((row) => ({ id: row.id, placeId: row.place_id })), moderatorId);
  } else {
    await db.run(sql`
      UPDATE contributions SET status = 'rejected', reviewed_by = ${moderatorId}, reviewed_at = ${now}, reason = ${reason}
      WHERE id IN (${sql.join(pending.map((row) => sql`${row.id}`), sql`, `)})
    `);
    await refreshStatus(db, submissionId, now);
  }
  await db.run(sql`
    INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, before_value, after_value, created_at)
    VALUES (${crypto.randomUUID()}, ${moderatorId}, ${`video-${decision}`}, 'video_submission', ${submissionId}, ${reason},
      ${JSON.stringify({ userId, places: pending.map((row) => row.place_id) })}, ${JSON.stringify(result)}, ${now})
  `);
  return { ok: true, value: result };
}
