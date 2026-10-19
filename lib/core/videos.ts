/**
 * Video paste (spec §5.1): the pure rules behind `lib/videos.ts`.
 *
 * A pasted YouTube video is read from cheap public metadata only: oEmbed (no
 * key) and, when a key is set, one Data API `videos.list` and one
 * `channels.list` call (1 unit each). No server-side LLM: the member picks the
 * places. New and restricted members' picks wait for a moderator; everyone
 * else's publish at once. A creator video is context, never evidence: it
 * feeds trust, not halal status.
 */
import { creatorImageUrl, isChannelId } from "./creators";
import { placeIdParam } from "./params";
import type { Tier } from "./trust";

/** Video submissions a member can make in a day (spec §2.6). */
export const VIDEOS_PER_DAY = 10;

/** Places one submission can name. */
export const MAX_VIDEO_PLACES = 10;

/** Cached metadata is re-fetched after this long (spec §11). */
export const VIDEO_META_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const VIDEO_STATUSES = ["fetched", "needs_review", "published", "rejected"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const CREATOR_LINK_KINDS = ["youtube", "instagram", "tiktok", "x", "website", "facebook"] as const;
export type CreatorLinkKind = (typeof CREATOR_LINK_KINDS)[number];

export type VideoChannel = {
  channelId: string;
  /** Lowercased, without @. Null when the channel has no handle. */
  handle: string | null;
  title: string | null;
  description: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  subscriberCount: number | null;
};

/** What we keep about a video, cached in `video_submissions.meta`. */
export type VideoMeta = {
  title: string | null;
  authorName: string | null;
  /** The channel's @handle from oEmbed's author_url, lowercased, without @. */
  authorHandle: string | null;
  thumbnailUrl: string | null;
  description: string | null;
  /** YYYY-MM-DD. */
  publishedAt: string | null;
  channel: VideoChannel | null;
  fetchedAt: number;
};

/** Members below Member tier go to the moderation queue (spec §2.6, §5.1). */
export function needsReview(tier: Tier): boolean {
  return tier === "new" || tier === "restricted";
}

/** Cached metadata is good for 30 days. */
export function isMetaFresh(meta: Pick<VideoMeta, "fetchedAt"> | null, now: number): boolean {
  return meta !== null && now - meta.fetchedAt < VIDEO_META_TTL_MS;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
  return clean ? Array.from(clean).slice(0, max).join("") : null;
}

function handleOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(?:https?:\/\/(?:www\.|m\.)?youtube\.com\/)?@([A-Za-z0-9._-]{1,40})\/?$/.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

/** The fields we keep from YouTube's oEmbed body. */
export function metaFromOEmbed(body: unknown): Pick<VideoMeta, "title" | "authorName" | "authorHandle" | "thumbnailUrl"> {
  const item = record(body);
  return {
    title: text(item.title, 300),
    authorName: text(item.author_name, 200),
    authorHandle: handleOf(item.author_url),
    thumbnailUrl: creatorImageUrl(item.thumbnail_url),
  };
}

/** channelId, description and publish date from a `videos.list?part=snippet` body. */
export function videoFromDataApi(body: unknown): { channelId: string; description: string | null; publishedAt: string | null } | null {
  const snippet = record(record((record(body).items as unknown[] | undefined)?.[0]).snippet);
  if (!isChannelId(snippet.channelId)) return null;
  const published = typeof snippet.publishedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(snippet.publishedAt) ? snippet.publishedAt.slice(0, 10) : null;
  return { channelId: snippet.channelId, description: text(snippet.description, 5000), publishedAt: published };
}

/** The channel from a `channels.list?part=snippet,statistics,brandingSettings` body. */
export function channelFromDataApi(body: unknown): VideoChannel | null {
  const item = record((record(body).items as unknown[] | undefined)?.[0]);
  if (!isChannelId(item.id)) return null;
  const snippet = record(item.snippet);
  const thumbnails = record(snippet.thumbnails);
  const avatar = record(thumbnails.high).url ?? record(thumbnails.medium).url ?? record(thumbnails.default).url;
  const subscribers = Number(record(item.statistics).subscriberCount);
  return {
    channelId: item.id,
    handle: handleOf(snippet.customUrl),
    title: text(snippet.title, 200),
    description: text(snippet.description, 5000),
    avatarUrl: creatorImageUrl(avatar),
    bannerUrl: creatorImageUrl(record(record(item.brandingSettings).image).bannerExternalUrl),
    subscriberCount: Number.isSafeInteger(subscribers) && subscribers >= 0 ? subscribers : null,
  };
}

const LINK_HOSTS: [RegExp, CreatorLinkKind][] = [
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(x|twitter)\.com$/, "x"],
  [/(^|\.)(facebook|fb)\.com$/, "facebook"],
];

/**
 * Socials found in a channel description: the first https link of each kind.
 * Other YouTube and Google links are skipped; the first other link is the website.
 */
export function creatorLinksFromText(description: string | null): { kind: CreatorLinkKind; url: string }[] {
  const found = new Map<CreatorLinkKind, string>();
  for (const raw of description?.match(/https?:\/\/[^\s<>"')]+/g) ?? []) {
    let url: URL;
    try {
      url = new URL(raw.replace(/[.,;:!?]+$/, "").replace(/^http:/, "https:"));
    } catch {
      continue;
    }
    if (url.username || url.password || url.port || url.href.length > 300) continue;
    const host = url.hostname.toLowerCase();
    if (/(^|\.)(youtube\.com|youtu\.be|google\.com|goo\.gl)$/.test(host)) continue;
    const kind = LINK_HOSTS.find(([pattern]) => pattern.test(host))?.[1] ?? "website";
    if (!found.has(kind)) found.set(kind, url.href);
  }
  return [...found].map(([kind, url]) => ({ kind, url }));
}

export type PlacePicks = { ok: true; placeIds: string[] } | { ok: false; error: string };

/** The places a member picked: 1 to 10 place ids, duplicates dropped. */
export function parsePlacePicks(value: unknown): PlacePicks {
  const list = record(value).placeIds;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: "Pick at least one place from the video." };
  const ids = new Set<string>();
  for (const item of list) {
    const id = placeIdParam(typeof item === "string" ? item : null);
    if (!id) return { ok: false, error: "One of those places is not valid." };
    ids.add(id);
  }
  if (ids.size > MAX_VIDEO_PLACES) return { ok: false, error: `Pick up to ${MAX_VIDEO_PLACES} places from one video.` };
  return { ok: true, placeIds: [...ids] };
}

/** The video's status from its places and its contributions waiting on review. */
export function videoStatus(state: { published: number; pending: number; rejected: number }): VideoStatus {
  if (state.published > 0) return "published";
  if (state.pending > 0) return "needs_review";
  if (state.rejected > 0) return "rejected";
  return "fetched";
}

/** A moderator's decision about one member's pending place picks. */
export function parseVideoReview(value: unknown):
  | { ok: true; userId: string; decision: "approve" | "reject"; reason: string | null }
  | { ok: false; error: string } {
  const input = record(value);
  if (typeof input.userId !== "string" || !input.userId.trim() || input.userId.length > 64)
    return { ok: false, error: "Say whose picks these are." };
  if (input.decision !== "approve" && input.decision !== "reject") return { ok: false, error: "Approve or reject it." };
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 300) : null;
  return { ok: true, userId: input.userId, decision: input.decision, reason };
}
