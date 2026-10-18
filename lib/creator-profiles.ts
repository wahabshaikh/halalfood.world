import { sql } from "drizzle-orm";
import { isUndeliverableEmail, youtubeWatchUrlAt } from "@/lib/core/creators";
import { parseStatus, type PlaceStatus } from "@/lib/core/halal";
import { database } from "@/lib/db";

/**
 * Public reads for creator profiles (written by Halal Food Scout, lib/scout/).
 * A creator verification is context for diners and never part of a place's
 * halal status.
 */

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type CreatorChannel = {
  platform: "youtube";
  channelId: string;
  channelHandle: string;
  channelUrl: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  subscriberCount: number | null;
  /** False until the creator proves they own the channel. Unclaimed profiles show "Is this you?". */
  claimed: boolean;
};

export type CreatorVerifiedPlace = {
  id: string;
  placeId: string;
  placeName: string;
  citySlug: string;
  addressLocality: string | null;
  status: PlaceStatus;
  videoUrl: string;
  timestampSeconds: number | null;
  videoDate: string | null;
};

export type PlaceCreatorVerification = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  videoUrl: string;
  timestampSeconds: number | null;
  videoDate: string | null;
};

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const text = (value: unknown) => (typeof value === "string" && value ? value : null);

/** The channel behind a profile, or null for an ordinary account. */
export async function getCreatorChannel(userId: string, client: Client = database()): Promise<CreatorChannel | null> {
  const db = await client;
  const [row] = await db.all<Record<string, unknown>>(sql`
    SELECT cp.*, u.email FROM creator_profiles cp JOIN "user" u ON u.id = cp.user_id WHERE cp.user_id = ${userId} LIMIT 1
  `);
  if (!row) return null;
  return {
    platform: "youtube",
    channelId: String(row.channel_id),
    channelHandle: String(row.channel_handle),
    channelUrl: String(row.channel_url),
    avatarUrl: text(row.avatar_url),
    bannerUrl: text(row.banner_url),
    subscriberCount: num(row.subscriber_count),
    claimed: row.claimed_at !== null || !isUndeliverableEmail(row.email),
  };
}

/** Listed places a creator showed in their videos, newest video first. */
export async function creatorVerifiedPlaces(userId: string, limit = 48, client: Client = database()): Promise<CreatorVerifiedPlace[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT v.id, v.place_id, v.video_id, v.timestamp_seconds, v.video_date, p.name, p.city_slug, p.address_locality, s.status, s.progress
    FROM creator_verifications v
    JOIN places p ON p.id = v.place_id AND p.listing_status = 'listed'
    JOIN place_status s ON s.place_id = p.id
    WHERE v.creator_user_id = ${userId}
    ORDER BY COALESCE(v.video_date, '') DESC, v.created_at DESC
    LIMIT ${Math.min(Math.max(Math.trunc(limit) || 48, 1), 100)}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    placeId: String(row.place_id),
    placeName: String(row.name),
    citySlug: String(row.city_slug),
    addressLocality: text(row.address_locality),
    status: parseStatus(row.status, row.progress),
    videoUrl: youtubeWatchUrlAt(String(row.video_id), num(row.timestamp_seconds)),
    timestampSeconds: num(row.timestamp_seconds),
    videoDate: text(row.video_date),
  }));
}

/** Creators who showed this place in a video. Suspended profiles are left out. */
export async function placeCreatorVerifications(placeId: string, client: Client = database()): Promise<PlaceCreatorVerification[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT v.id, v.video_id, v.timestamp_seconds, v.video_date, pr.handle, pr.display_name, cp.avatar_url
    FROM creator_verifications v
    JOIN profiles pr ON pr.user_id = v.creator_user_id AND pr.suspended_at IS NULL
    JOIN creator_profiles cp ON cp.user_id = v.creator_user_id
    WHERE v.place_id = ${placeId}
    ORDER BY COALESCE(v.video_date, '') DESC, v.created_at DESC
    LIMIT 12
  `);
  return rows.map((row) => ({
    id: String(row.id),
    handle: String(row.handle),
    displayName: String(row.display_name ?? row.handle),
    avatarUrl: text(row.avatar_url),
    videoUrl: youtubeWatchUrlAt(String(row.video_id), num(row.timestamp_seconds)),
    timestampSeconds: num(row.timestamp_seconds),
    videoDate: text(row.video_date),
  }));
}

/** The /u/ handle of the creator profile for a YouTube channel handle, for links from /creator/youtube/<handle>. */
export async function profileHandleForChannel(platform: string, channelHandle: string, client: Client = database()): Promise<string | null> {
  if (platform !== "youtube") return null;
  const db = await client;
  const [row] = await db.all<{ handle: string }>(sql`
    SELECT pr.handle FROM creator_profiles cp JOIN profiles pr ON pr.user_id = cp.user_id AND pr.suspended_at IS NULL
    WHERE cp.platform = 'youtube' AND cp.channel_handle = ${channelHandle.toLowerCase()}
    LIMIT 1
  `);
  return row?.handle ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar 2026" for a YYYY-MM-DD video date. Spelled out here: ICU versions disagree on "Sep" and "Sept". */
export function videoMonth(date: string | null): string | null {
  const match = date ? /^(\d{4})-(\d{2})-\d{2}$/.exec(date) : null;
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${month} ${match[1]}` : null;
}
