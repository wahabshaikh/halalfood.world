/**
 * add_verification / remove_verification: a creator showed a place in a video.
 *
 * Stored in `creator_verifications`, one row per (creator, place, video), and
 * mirrored as a `place_media_links` row so the place's Videos strip and the
 * creator page pick the video up. Removing a verification removes only the
 * media link it added. A verification is context, never evidence: it does not
 * touch checks, place_signals or place_status (docs/spec/halal-model.md). It
 * does show the place exists, so both writes recompute an imported place's
 * "Unverified" label (lib/provenance.ts), and it earns Creator verified, so
 * both recompute the place's trust (lib/trust.ts).
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  parseVideoDate,
  parseVideoTimestamp,
  youtubeThumbnailUrl,
  youtubeVideoId,
  youtubeWatchUrl,
  youtubeWatchUrlAt,
} from "@/lib/core/creators";
import { placeIdParam } from "@/lib/core/params";
import { runBatch } from "@/lib/checks-repository";
import { recomputePlaceVerification } from "@/lib/provenance";
import { recomputeTrust } from "@/lib/trust";
import { findCreator, isClaimedCreator } from "./creators";
import type { ScoutDeps } from "./deps";
import { targetPlace, type PlaceFailure } from "./places";

const creatorRef = z.string().trim().min(1).max(120).describe("The creator's @handle or YouTube channel id (UC…).");
const placeRef = z.string().trim().min(1).max(64).describe("The place id from find_place or upsert_place.");
const videoRef = z.string().trim().min(1).max(2048).describe("Any YouTube link to the video (watch, youtu.be, shorts, live) or its 11-character id.");

export const addVerificationInput = z.object({
  creator: creatorRef,
  place_id: placeRef,
  video_url: videoRef,
  timestamp: z.union([z.number().int(), z.string().max(16)]).optional().describe('Where the place appears: seconds (83) or "1:23" / "1:02:03".'),
  date: z.string().max(40).optional().describe("The video's publish date, ISO (2026-10-18)."),
  title: z.string().max(300).optional().describe("The video's title, shown with the video."),
});
export type AddVerificationInput = z.infer<typeof addVerificationInput>;

export const removeVerificationInput = z
  .object({
    id: z.string().trim().min(1).max(64).optional().describe("The verification id from add_verification."),
    creator: creatorRef.optional(),
    place_id: placeRef.optional(),
    video_url: videoRef.optional(),
  })
  .refine((value) => value.id !== undefined || (value.creator !== undefined && value.place_id !== undefined && value.video_url !== undefined), {
    message: "Send the verification id, or creator, place_id and video_url together.",
  });
export type RemoveVerificationInput = z.infer<typeof removeVerificationInput>;

type Failure = { ok: false; error: string; message: string };

export type VerificationSummary = {
  id: string;
  creator: string;
  place_id: string;
  video_id: string;
  video_url: string;
  timestamp_seconds: number | null;
  date: string | null;
  creator_url: string;
  place_url: string;
};

export type AddVerificationResult = { ok: true; result: "created" | "matched" | "updated"; verification: VerificationSummary } | PlaceFailure;
export type RemoveVerificationResult = { ok: true; removed: boolean; id: string | null } | Failure;

type VerificationRow = {
  id: string;
  creator_user_id: string;
  place_id: string;
  video_id: string;
  video_url: string;
  timestamp_seconds: number | null;
  video_date: string | null;
  media_link_id: string | null;
};

const clean = (value: string | undefined, max: number) => {
  const text = value?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text ? Array.from(text).slice(0, max).join("") : null;
};

function summary(deps: ScoutDeps, handle: string, row: VerificationRow): VerificationSummary {
  return {
    id: row.id,
    creator: handle,
    place_id: row.place_id,
    video_id: row.video_id,
    video_url: youtubeWatchUrlAt(row.video_id, row.timestamp_seconds),
    timestamp_seconds: row.timestamp_seconds,
    date: row.video_date,
    creator_url: `${deps.origin}/u/${handle}`,
    place_url: `${deps.origin}/place/${row.place_id}`,
  };
}

async function verificationByKey(deps: ScoutDeps, creatorUserId: string, placeId: string, videoId: string) {
  const [row] = await deps.db.all<VerificationRow>(sql`
    SELECT id, creator_user_id, place_id, video_id, video_url, timestamp_seconds, video_date, media_link_id
    FROM creator_verifications
    WHERE creator_user_id = ${creatorUserId} AND place_id = ${placeId} AND video_id = ${videoId}
    LIMIT 1
  `);
  return row ?? null;
}

/** `source` records who added it: Scout, or a member's video paste (lib/videos.ts). */
export async function addVerification(
  deps: ScoutDeps,
  input: AddVerificationInput,
  source: "scout" | "member" = "scout",
): Promise<AddVerificationResult> {
  const placeId = placeIdParam(input.place_id);
  if (!placeId) return { ok: false, error: "invalid_place_id", message: "place_id is the id from find_place or upsert_place." };
  const videoId = youtubeVideoId(input.video_url);
  if (!videoId) return { ok: false, error: "invalid_video_url", message: "Send a YouTube video link (watch, youtu.be, shorts or live)." };
  const timestamp = parseVideoTimestamp(input.timestamp);
  if (!timestamp.ok) return { ok: false, error: "invalid_timestamp", message: timestamp.error };
  const date = parseVideoDate(input.date, deps.now());
  if (!date.ok) return { ok: false, error: "invalid_date", message: date.error };

  const creator = await findCreator(deps, input.creator);
  if (!creator) return { ok: false, error: "creator_not_found", message: "No creator profile has that handle or channel id. Run upsert_creator first." };
  if (source === "scout" && isClaimedCreator(creator))
    return { ok: false, error: "creator_claimed", message: `@${creator.handle} claimed their profile; Scout no longer adds to it.` };

  const target = await targetPlace(deps, placeId);
  if (!target.ok) return target;

  const now = deps.now();
  const existing = await verificationByKey(deps, creator.user_id, placeId, videoId);
  if (existing) {
    const nextTimestamp = timestamp.seconds ?? existing.timestamp_seconds;
    const nextDate = date.date ?? existing.video_date;
    if (nextTimestamp === existing.timestamp_seconds && nextDate === existing.video_date)
      return { ok: true, result: "matched", verification: summary(deps, creator.handle, existing) };
    await deps.db.run(sql`
      UPDATE creator_verifications SET timestamp_seconds = ${nextTimestamp}, video_date = ${nextDate}, updated_at = ${now}
      WHERE id = ${existing.id}
    `);
    return { ok: true, result: "updated", verification: summary(deps, creator.handle, { ...existing, timestamp_seconds: nextTimestamp, video_date: nextDate }) };
  }

  const url = youtubeWatchUrl(videoId);
  const [link] = await deps.db.all<{ id: string }>(sql`SELECT id FROM place_media_links WHERE place_id = ${placeId} AND url = ${url} LIMIT 1`);
  // A person may have linked the video already; then the link is theirs and stays when this is removed.
  const mediaLinkId = link ? null : crypto.randomUUID();
  const [profile] = await deps.db.all<{ display_name: string | null }>(sql`SELECT display_name FROM profiles WHERE user_id = ${creator.user_id}`);
  const [channel] = await deps.db.all<{ channel_handle: string }>(sql`SELECT channel_handle FROM creator_profiles WHERE user_id = ${creator.user_id}`);
  const id = crypto.randomUUID();
  await runBatch(deps.db, [
    ...(mediaLinkId
      ? [
          sql`INSERT OR IGNORE INTO place_media_links (id, place_id, submitted_by_user_id, platform, url, author_handle, author_name, title, thumbnail_url, created_at)
              VALUES (${mediaLinkId}, ${placeId}, NULL, 'youtube', ${url}, ${channel?.channel_handle ?? creator.handle},
                ${profile?.display_name ?? null}, ${clean(input.title, 200)}, ${youtubeThumbnailUrl(videoId)}, ${now})`,
        ]
      : []),
    sql`INSERT INTO creator_verifications (id, creator_user_id, place_id, platform, video_id, video_url, timestamp_seconds, video_date,
          media_link_id, source, created_at, updated_at)
        VALUES (${id}, ${creator.user_id}, ${placeId}, 'youtube', ${videoId}, ${url}, ${timestamp.seconds}, ${date.date},
          ${mediaLinkId ? sql`(SELECT id FROM place_media_links WHERE id = ${mediaLinkId})` : null}, ${source}, ${now}, ${now})
        ON CONFLICT (creator_user_id, place_id, video_id) DO NOTHING`,
  ]);
  const row = await verificationByKey(deps, creator.user_id, placeId, videoId);
  if (!row) throw new Error("creator verification was not written");
  await recomputePlaceVerification(placeId, deps.db, now);
  await recomputeTrust(placeId, deps.db, now);
  return { ok: true, result: row.id === id ? "created" : "matched", verification: summary(deps, creator.handle, row) };
}

export async function removeVerification(deps: ScoutDeps, input: RemoveVerificationInput): Promise<RemoveVerificationResult> {
  let row: VerificationRow | null = null;
  if (input.id) {
    const [found] = await deps.db.all<VerificationRow>(sql`
      SELECT id, creator_user_id, place_id, video_id, video_url, timestamp_seconds, video_date, media_link_id
      FROM creator_verifications WHERE id = ${input.id} LIMIT 1
    `);
    row = found ?? null;
  } else {
    const placeId = placeIdParam(input.place_id ?? "");
    const videoId = youtubeVideoId(input.video_url);
    if (!placeId) return { ok: false, error: "invalid_place_id", message: "place_id is the id from find_place or upsert_place." };
    if (!videoId) return { ok: false, error: "invalid_video_url", message: "Send a YouTube video link (watch, youtu.be, shorts or live)." };
    const creator = await findCreator(deps, input.creator ?? "");
    row = creator ? await verificationByKey(deps, creator.user_id, placeId, videoId) : null;
  }
  if (!row) return { ok: true, removed: false, id: null };
  const [owner] = await deps.db.all<{ claimed_at: number | null; email: string; handle: string }>(sql`
    SELECT cp.claimed_at, u.email, pr.handle FROM creator_profiles cp
    JOIN "user" u ON u.id = cp.user_id JOIN profiles pr ON pr.user_id = cp.user_id
    WHERE cp.user_id = ${row.creator_user_id}
  `);
  if (owner && isClaimedCreator(owner))
    return { ok: false, error: "creator_claimed", message: `@${owner.handle} claimed their profile; Scout no longer changes it.` };
  await runBatch(deps.db, [
    sql`DELETE FROM creator_verifications WHERE id = ${row.id}`,
    ...(row.media_link_id ? [sql`DELETE FROM place_media_links WHERE id = ${row.media_link_id}`] : []),
  ]);
  await recomputePlaceVerification(row.place_id, deps.db, deps.now());
  await recomputeTrust(row.place_id, deps.db, deps.now());
  return { ok: true, removed: true, id: row.id };
}
