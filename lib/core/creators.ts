/**
 * Creator profiles from YouTube: handles, channel ids, image hosts, video links,
 * timestamps and the placeholder email that keeps an unclaimed creator from
 * signing in. Pure, so the mobile app can share it. A creator's video is
 * context, never evidence: nothing here touches halal status.
 */
import { validateHandle, type HandleValidation } from "./people";

/** YouTube channel ids are `UC` followed by 22 base64url characters. */
export const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

/** Every unclaimed creator's `user.email` ends with this. `.invalid` is reserved (RFC 2606) and never delivers. */
export const UNCLAIMED_EMAIL_DOMAIN = "unclaimed.invalid";

/** Hosts YouTube serves channel avatars and banners from. Anything else is refused. */
const IMAGE_HOSTS = [/^yt3\.ggpht\.com$/, /^yt3\.googleusercontent\.com$/, /^i\.ytimg\.com$/, /^lh3\.googleusercontent\.com$/];

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The profile handle for a YouTube handle: lowercased, without `@`. YouTube allows
 * hyphens and handles up to 30 characters; ours don't allow hyphens, so such a
 * channel gets a clear error instead of a silently different handle.
 */
export function creatorHandle(value: unknown): HandleValidation {
  if (typeof value !== "string") return { ok: false, error: "Send the channel's YouTube handle." };
  let raw = value.trim();
  // Accept the channel URL too: https://www.youtube.com/@handle
  const fromUrl = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/@([^/?#]+)/i.exec(raw);
  if (fromUrl) raw = decodeURIComponent(fromUrl[1]);
  const handle = raw.replace(/^@/, "").toLowerCase();
  if (handle.includes("-"))
    return { ok: false, error: `@${handle} has a hyphen, and halalfood.world handles can't. Nothing was created.` };
  const valid = validateHandle(handle);
  return valid.ok ? valid : { ok: false, error: `@${handle} can't be a halalfood.world handle: ${valid.error}` };
}

export function isChannelId(value: unknown): value is string {
  return typeof value === "string" && CHANNEL_ID_PATTERN.test(value);
}

/** The canonical channel URL: by handle when there is one, else by id. */
export function channelUrl(channelId: string, handle?: string | null): string {
  return handle ? `https://www.youtube.com/@${handle}` : `https://www.youtube.com/channel/${channelId}`;
}

/** A channel URL we accept from the importer: https on youtube.com, normalised. Null otherwise. */
export function normalizeChannelUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!/^(?:www\.|m\.)?youtube\.com$/i.test(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!/^\/(?:@[A-Za-z0-9._-]{1,40}|channel\/UC[A-Za-z0-9_-]{22}|c\/[A-Za-z0-9._-]{1,100}|user\/[A-Za-z0-9._-]{1,100})$/.test(path)) return null;
  return `https://www.youtube.com${path}`;
}

/** An https image on one of YouTube's image hosts, or null. We render these directly and never fetch them. */
export function creatorImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  return IMAGE_HOSTS.some((pattern) => pattern.test(host)) ? url.href : null;
}

/** The placeholder email for an unclaimed creator's user row. Unique because the user id is. */
export function unclaimedCreatorEmail(userId: string): string {
  return `creator-${userId}@${UNCLAIMED_EMAIL_DOMAIN}`;
}

/** True for an address that can never receive mail: anything under the reserved `.invalid` TLD. */
export function isUndeliverableEmail(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const domain = value.trim().toLowerCase().split("@").pop() ?? "";
  return domain === "invalid" || domain.endsWith(".invalid");
}

/** The YouTube video id in a watch, youtu.be, shorts, live or embed link. Null for anything else. */
export function youtubeVideoId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const raw = value.trim();
  if (VIDEO_ID.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined = null;
  if (host === "youtu.be") id = parts[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (["shorts", "live", "embed", "v"].includes(parts[0] ?? "")) id = parts[1];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** The canonical link we store for a video. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** The video at a moment, for links on the page. */
export function youtubeWatchUrlAt(videoId: string, seconds: number | null): string {
  return seconds ? `${youtubeWatchUrl(videoId)}&t=${seconds}s` : youtubeWatchUrl(videoId);
}

/** YouTube's own thumbnail for a video. */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Twelve hours: longer than any video we'd link, short enough to catch a typo. */
export const MAX_TIMESTAMP_SECONDS = 12 * 60 * 60;

export type TimestampResult = { ok: true; seconds: number | null } | { ok: false; error: string };

/** Seconds into a video from 83, "83", "83s", "1:23", "1:02:03" or "1h2m3s". Empty means none. */
export function parseVideoTimestamp(value: unknown): TimestampResult {
  const invalid = { ok: false as const, error: "Timestamps are seconds (83) or m:ss / h:mm:ss (1:23)." };
  if (value === undefined || value === null || value === "") return { ok: true, seconds: null };
  let seconds: number;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return invalid;
    seconds = value;
  } else if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    const clock = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(text);
    const units = /^(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?:(\d{1,5})s?)?$/.exec(text);
    if (clock) {
      if (Number(clock[3]) >= 60 || (clock[1] !== undefined && Number(clock[2]) >= 60)) return invalid;
      seconds = Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    } else if (units && /\d/.test(text)) seconds = Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
    else return invalid;
  } else return invalid;
  if (seconds < 0 || seconds > MAX_TIMESTAMP_SECONDS) return { ok: false, error: "That timestamp is longer than any video." };
  return { ok: true, seconds };
}

/** "1:23" or "1:02:03" for a page. */
export function formatVideoTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export type DateResult = { ok: true; date: string | null } | { ok: false; error: string };

/** A real calendar date as YYYY-MM-DD; a full ISO timestamp is cut to its date. Not in the future. */
export function parseVideoDate(value: unknown, now = Date.now()): DateResult {
  if (value === undefined || value === null || value === "") return { ok: true, date: null };
  const invalid = { ok: false as const, error: "Dates are ISO dates, like 2026-10-18." };
  if (typeof value !== "string") return invalid;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
  if (!match) return invalid;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const at = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== date) return invalid;
  if (Number(match[1]) < 2005) return { ok: false, error: "YouTube didn't exist before 2005." };
  if (at > now + 24 * 60 * 60 * 1000) return { ok: false, error: "That date is in the future." };
  return { ok: true, date };
}

/** "1.2M", "45K", "980" subscribers. */
export function formatSubscriberCount(count: number): string {
  if (count >= 1_000_000) return `${trim(count / 1_000_000)}M`;
  if (count >= 1_000) return `${trim(count / 1_000)}K`;
  return String(count);
}

function trim(value: number): string {
  return value >= 100 ? String(Math.floor(value)) : (Math.floor(value * 10) / 10).toString();
}
