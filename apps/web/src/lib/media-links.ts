import { sql } from "drizzle-orm";
import { database } from "../db";
import { cachedRead } from "./read-cache";

/**
 * Creator videos linked to places. A person pastes an Instagram, TikTok or
 * YouTube URL; we normalise it, read the platform's public oEmbed data for
 * the creator's handle, name and thumbnail, and store the result. Nothing
 * about the creator is ever typed in by hand.
 */
export const MEDIA_PLATFORMS = ["instagram", "tiktok", "youtube"] as const;
export type MediaPlatform = (typeof MEDIA_PLATFORMS)[number];

export const MEDIA_PLATFORM_LABELS: Record<MediaPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export type ParsedMediaUrl = {
  platform: MediaPlatform;
  url: string;
  /** Handle visible in the URL itself (TikTok), before any oEmbed lookup. */
  handle: string | null;
};

export type MediaMetadata = {
  handle: string | null;
  authorName: string | null;
  title: string | null;
  thumbnailUrl: string | null;
};

export type PlaceMediaLink = {
  id: string;
  platform: MediaPlatform;
  url: string;
  authorHandle: string | null;
  authorName: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
};

export type CreatorPlace = {
  placeId: string;
  placeName: string;
  citySlug: string;
  addressLocality: string | null;
  ratingValue: string | null;
  reviewCount: number | null;
  streetAddress: string;
  url: string;
  title: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
};

export type CreatorProfile = {
  platform: MediaPlatform;
  handle: string;
  authorName: string | null;
  places: CreatorPlace[];
};

const VIDEO_ID = /^[A-Za-z0-9_-]{4,64}$/;
const HANDLE = /^[A-Za-z0-9._-]{1,40}$/;
const MAX_TEXT = 200;

export function isMediaPlatform(value: unknown): value is MediaPlatform {
  return typeof value === "string" && (MEDIA_PLATFORMS as readonly string[]).includes(value);
}

/** Lower-case a creator handle and drop a leading @; null when it is not a valid handle. */
export function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  return HANDLE.test(handle) ? handle : null;
}

function segments(pathname: string) {
  return pathname.split("/").filter(Boolean);
}

/** Accept only public post URLs from the three platforms, in a canonical form. */
export function parseMediaUrl(raw: unknown): ParsedMediaUrl | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
  const parts = segments(url.pathname);

  if (host === "tiktok.com") {
    // https://www.tiktok.com/@handle/video/1234567890
    if (parts.length >= 3 && parts[0].startsWith("@") && parts[1] === "video") {
      const handle = normalizeHandle(parts[0]);
      if (!handle || !/^\d{6,25}$/.test(parts[2])) return null;
      return {
        platform: "tiktok",
        url: `https://www.tiktok.com/@${handle}/video/${parts[2]}`,
        handle,
      };
    }
    return null;
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    if (parts.length !== 1 || !VIDEO_ID.test(parts[0])) return null;
    return { platform: "tiktok", url: `https://${host}/${parts[0]}/`, handle: null };
  }

  if (host === "youtube.com") {
    if (parts[0] === "watch") {
      const id = url.searchParams.get("v");
      if (!id || !VIDEO_ID.test(id)) return null;
      return { platform: "youtube", url: `https://www.youtube.com/watch?v=${id}`, handle: null };
    }
    if (parts[0] === "shorts" && parts[1] && VIDEO_ID.test(parts[1]))
      return { platform: "youtube", url: `https://www.youtube.com/shorts/${parts[1]}`, handle: null };
    return null;
  }
  if (host === "youtu.be") {
    if (parts.length !== 1 || !VIDEO_ID.test(parts[0])) return null;
    return { platform: "youtube", url: `https://www.youtube.com/watch?v=${parts[0]}`, handle: null };
  }

  if (host === "instagram.com") {
    // /p/CODE, /reel/CODE, /reels/CODE, optionally /handle/p/CODE
    const offset = parts[0] === "p" || parts[0] === "reel" || parts[0] === "reels" ? 0 : 1;
    const kind = parts[offset];
    const code = parts[offset + 1];
    if (!code || !VIDEO_ID.test(code) || !["p", "reel", "reels"].includes(kind ?? ""))
      return null;
    return {
      platform: "instagram",
      url: `https://www.instagram.com/${kind === "p" ? "p" : "reel"}/${code}/`,
      handle: null,
    };
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_TEXT ? cleaned.slice(0, MAX_TEXT - 1) + "…" : cleaned;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function handleFromAuthorUrl(value: unknown): string | null {
  const url = httpsUrl(value);
  if (!url) return null;
  const first = segments(new URL(url).pathname)[0];
  return first?.startsWith("@") ? normalizeHandle(first) : null;
}

/** Pick the fields we keep from an oEmbed JSON body. Pure, so it is unit-tested. */
export function metadataFromOEmbed(
  platform: MediaPlatform,
  body: unknown,
  urlHandle: string | null,
): MediaMetadata {
  const item =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const handle =
    urlHandle ??
    (platform === "tiktok" ? normalizeHandle(item.author_unique_id) : null) ??
    handleFromAuthorUrl(item.author_url);
  return {
    handle,
    authorName: text(item.author_name),
    title: text(item.title),
    thumbnailUrl: httpsUrl(item.thumbnail_url),
  };
}

export function oEmbedEndpoint(parsed: ParsedMediaUrl): string | null {
  if (parsed.platform === "tiktok")
    return "https://www.tiktok.com/oembed?url=" + encodeURIComponent(parsed.url);
  if (parsed.platform === "youtube")
    return "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(parsed.url);
  // Instagram's oEmbed needs an app token, so those links keep only the URL.
  return null;
}

/**
 * Enrich a parsed URL from the platform's public oEmbed endpoint. Any
 * failure falls back to what the URL itself tells us.
 */
export async function fetchMediaMetadata(
  parsed: ParsedMediaUrl,
  fetcher: typeof fetch = fetch,
): Promise<MediaMetadata> {
  const fallback: MediaMetadata = {
    handle: parsed.handle,
    authorName: null,
    title: null,
    thumbnailUrl: null,
  };
  const endpoint = oEmbedEndpoint(parsed);
  if (!endpoint) return fallback;
  try {
    const response = await fetcher(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return fallback;
    return metadataFromOEmbed(parsed.platform, await response.json(), parsed.handle);
  } catch {
    return fallback;
  }
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string" && /^\d+$/.test(value)) return new Date(Number(value)).toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function mapLink(row: Record<string, unknown>): PlaceMediaLink | null {
  if (typeof row.id !== "string" || !isMediaPlatform(row.platform) || typeof row.url !== "string")
    return null;
  return {
    id: row.id,
    platform: row.platform,
    url: row.url,
    authorHandle: nullableText(row.author_handle),
    authorName: nullableText(row.author_name),
    title: nullableText(row.title),
    thumbnailUrl: nullableText(row.thumbnail_url),
    createdAt: isoDate(row.created_at),
  };
}

export interface MediaLinkRepository {
  hasPlace(placeId: string): Promise<boolean>;
  list(placeId: string): Promise<PlaceMediaLink[]>;
  /** Returns false when the same URL is already linked to this place. */
  create(
    userId: string,
    placeId: string,
    parsed: ParsedMediaUrl,
    metadata: MediaMetadata,
  ): Promise<boolean>;
}

export function d1MediaLinkRepository(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): MediaLinkRepository {
  return {
    async hasPlace(placeId) {
      const db = await client;
      const rows = await db.all(sql`
        SELECT 1 FROM places WHERE id = ${placeId} AND halal_confirmed = 1 LIMIT 1
      `);
      return rows.length > 0;
    },

    async list(placeId) {
      const db = await client;
      const rows = await db.all<Record<string, unknown>>(sql`
        SELECT id, platform, url, author_handle, author_name, title, thumbnail_url, created_at
        FROM place_media_links
        WHERE place_id = ${placeId}
        ORDER BY created_at DESC, id DESC
        LIMIT 24
      `);
      return rows.flatMap((row) => {
        const link = mapLink(row);
        return link ? [link] : [];
      });
    },

    async create(userId, placeId, parsed, metadata) {
      const db = await client;
      const id = crypto.randomUUID();
      await db.run(sql`
        INSERT OR IGNORE INTO place_media_links (
          id, place_id, submitted_by_user_id, platform, url, author_handle,
          author_name, title, thumbnail_url, created_at
        ) VALUES (
          ${id}, ${placeId}, ${userId}, ${parsed.platform}, ${parsed.url},
          ${metadata.handle}, ${metadata.authorName}, ${metadata.title},
          ${metadata.thumbnailUrl}, ${Date.now()}
        )
      `);
      const rows = await db.all(sql`SELECT 1 FROM place_media_links WHERE id = ${id} LIMIT 1`);
      return rows.length > 0;
    },
  };
}

/** Every place a creator has been linked to, newest first. */
export async function getCreatorProfile(
  platform: MediaPlatform,
  handle: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<CreatorProfile | null> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT m.place_id, m.url, m.title, m.thumbnail_url, m.author_name, m.created_at,
      p.name AS place_name, p.city_slug, p.address_locality, p.rating_value,
      p.review_count, p.street_address
    FROM place_media_links AS m
    INNER JOIN places AS p ON p.id = m.place_id AND p.halal_confirmed = 1
    WHERE m.platform = ${platform} AND m.author_handle = ${handle}
    ORDER BY m.created_at DESC
    LIMIT 200
  `);
  if (!rows.length) return null;
  const seen = new Set<string>();
  const places: CreatorPlace[] = [];
  for (const row of rows) {
    const placeId = String(row.place_id);
    if (seen.has(placeId)) continue;
    seen.add(placeId);
    places.push({
      placeId,
      placeName: String(row.place_name),
      citySlug: String(row.city_slug),
      addressLocality: nullableText(row.address_locality),
      ratingValue: nullableText(row.rating_value),
      reviewCount: typeof row.review_count === "number" ? row.review_count : null,
      streetAddress: String(row.street_address ?? ""),
      url: String(row.url),
      title: nullableText(row.title),
      thumbnailUrl: nullableText(row.thumbnail_url),
      createdAt: isoDate(row.created_at),
    });
  }
  const authorName = rows.map((row) => nullableText(row.author_name)).find(Boolean) ?? null;
  return { platform, handle, authorName, places };
}

export type CreatorSummary = {
  platform: MediaPlatform;
  handle: string;
  authorName: string | null;
  placeCount: number;
  videoCount: number;
};

/** Creators with the most linked places, for the community page. */
/** Public and the same for every visitor, so the default read is cached. */
export async function listTopCreators(
  limit = 12,
  client?: DatabaseClient | Promise<DatabaseClient>,
): Promise<CreatorSummary[]> {
  if (client) return queryTopCreators(limit, client);
  return cachedRead(`leaderboard:creators:v1:${limit}`, 10 * 60, () =>
    queryTopCreators(limit, database()),
  );
}

async function queryTopCreators(
  limit: number,
  client: DatabaseClient | Promise<DatabaseClient>,
): Promise<CreatorSummary[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT m.platform, m.author_handle, max(m.author_name) AS author_name,
      count(DISTINCT m.place_id) AS place_count, count(*) AS video_count
    FROM place_media_links AS m
    INNER JOIN places AS p ON p.id = m.place_id AND p.halal_confirmed = 1
    WHERE m.author_handle IS NOT NULL
    GROUP BY m.platform, m.author_handle
    ORDER BY place_count DESC, video_count DESC, m.author_handle
    LIMIT ${Math.min(Math.max(Math.trunc(limit) || 12, 1), 50)}
  `);
  return rows.flatMap((row) =>
    isMediaPlatform(row.platform) && typeof row.author_handle === "string"
      ? [
          {
            platform: row.platform,
            handle: row.author_handle,
            authorName: nullableText(row.author_name),
            placeCount: Number(row.place_count) || 0,
            videoCount: Number(row.video_count) || 0,
          },
        ]
      : [],
  );
}

export function creatorPath(platform: MediaPlatform, handle: string) {
  return `/creator/${platform}/${encodeURIComponent(handle)}`;
}
