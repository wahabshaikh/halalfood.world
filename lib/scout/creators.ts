/**
 * upsert_creator: an unclaimed, claimable profile for a YouTube creator.
 *
 * A creator is an ordinary `user` + `profiles` row, so it renders at
 * /u/<handle> like anyone else, plus a `creator_profiles` row with the channel.
 * Its email is a placeholder under `.invalid`, which the auth route refuses, so
 * nobody can sign in as it. The channel id is the identity; the handle follows
 * the channel when it is free. A claimed profile, or a handle that belongs to a
 * person who signed up, is never written to.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  CHANNEL_ID_PATTERN,
  channelUrl,
  creatorHandle,
  creatorImageUrl,
  isChannelId,
  isUndeliverableEmail,
  normalizeChannelUrl,
  unclaimedCreatorEmail,
} from "@/lib/core/creators";
import { BIO_MAX, DISPLAY_NAME_MAX, validateDisplayName } from "@/lib/core/people";
import { runBatch } from "@/lib/checks-repository";
import { isHandleAvailable } from "@/lib/profiles";
import type { ScoutDeps } from "./deps";

export const upsertCreatorInput = z.object({
  handle: z.string().min(1).max(120).describe("The channel's YouTube handle, with or without @, or its https://www.youtube.com/@handle URL. Becomes the profile handle."),
  channel_id: z.string().regex(CHANNEL_ID_PATTERN, "A YouTube channel id is UC followed by 22 characters.").describe("YouTube channel id (UC…). The creator's stable identity."),
  display_name: z.string().min(1).max(200).describe(`Channel name. Clipped to ${DISPLAY_NAME_MAX} characters.`),
  bio: z.string().max(5000).nullish().describe(`Channel description. Clipped to ${BIO_MAX} characters.`),
  avatar_url: z.string().max(1000).nullish().describe("https avatar on yt3.ggpht.com / yt3.googleusercontent.com / i.ytimg.com. Other hosts are skipped with a warning."),
  banner_url: z.string().max(1000).nullish().describe("https banner on the same hosts as avatar_url."),
  channel_url: z.string().max(300).nullish().describe("https://www.youtube.com/@handle or /channel/UC…. Defaults to the @handle URL."),
  subscriber_count: z.number().int().min(0).max(100_000_000_000).nullish(),
});
export type UpsertCreatorInput = z.infer<typeof upsertCreatorInput>;

export type CreatorFailure = { ok: false; error: string; message: string };
export type UpsertCreatorResult =
  | {
      ok: true;
      result: "created" | "updated" | "claimed";
      handle: string;
      channel_id: string;
      url: string;
      claimed: boolean;
      warnings: string[];
    }
  | CreatorFailure;

type ExistingCreator = {
  user_id: string;
  handle: string;
  channel_id: string;
  claimed_at: number | null;
  email: string;
};

function clip(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : value;
}

/** Bio text as the profile stores it: control characters out, clipped to the column's limit. */
function cleanBio(value: string | null | undefined, warnings: string[]): string | null {
  if (!value) return null;
  const bio = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!bio) return null;
  if (Array.from(bio).length > BIO_MAX) warnings.push(`bio_clipped: profiles keep ${BIO_MAX} characters.`);
  return clip(bio, BIO_MAX);
}

function image(value: string | null | undefined, field: string, warnings: string[]): string | null {
  if (!value) return null;
  const url = creatorImageUrl(value);
  if (!url) warnings.push(`${field}_skipped: only https images on YouTube's image hosts are shown.`);
  return url;
}

/** Someone owns this row: it was claimed, or its user has a real email (a person who signed up). */
function isClaimed(row: { claimed_at: number | null; email: string }): boolean {
  return row.claimed_at !== null || !isUndeliverableEmail(row.email);
}

async function creatorByChannel(deps: ScoutDeps, channelId: string): Promise<ExistingCreator | null> {
  const [row] = await deps.db.all<ExistingCreator>(sql`
    SELECT cp.user_id, pr.handle, cp.channel_id, cp.claimed_at, u.email
    FROM creator_profiles cp
    JOIN profiles pr ON pr.user_id = cp.user_id
    JOIN "user" u ON u.id = cp.user_id
    WHERE cp.platform = 'youtube' AND cp.channel_id = ${channelId}
    LIMIT 1
  `);
  return row ?? null;
}

/** A creator by @handle or channel id, for add_verification. Null when neither names a creator. */
export async function findCreator(deps: ScoutDeps, ref: string): Promise<ExistingCreator | null> {
  const value = ref.trim();
  if (isChannelId(value)) return creatorByChannel(deps, value);
  const handle = creatorHandle(value);
  if (!handle.ok) return null;
  const [row] = await deps.db.all<ExistingCreator>(sql`
    SELECT cp.user_id, pr.handle, cp.channel_id, cp.claimed_at, u.email
    FROM profiles pr
    JOIN creator_profiles cp ON cp.user_id = pr.user_id
    JOIN "user" u ON u.id = pr.user_id
    WHERE lower(pr.handle) = lower(${handle.handle})
    LIMIT 1
  `);
  return row ?? null;
}

export { isClaimed as isClaimedCreator };

const isUnique = (error: unknown) => /unique/i.test(error instanceof Error ? error.message : String(error));

/** `source` records who created the row: Scout, or a member's video paste (lib/videos.ts). */
export async function upsertCreator(
  deps: ScoutDeps,
  input: UpsertCreatorInput,
  source: "scout" | "member" = "scout",
): Promise<UpsertCreatorResult> {
  const handle = creatorHandle(input.handle);
  if (!handle.ok) return { ok: false, error: "invalid_handle", message: handle.error };
  if (!isChannelId(input.channel_id)) return { ok: false, error: "invalid_channel_id", message: "A YouTube channel id is UC followed by 22 characters." };
  const warnings: string[] = [];
  const rawName = input.display_name.replace(/\s+/g, " ").trim();
  if (Array.from(rawName).length > DISPLAY_NAME_MAX) warnings.push(`display_name_clipped: names keep ${DISPLAY_NAME_MAX} characters.`);
  const name = validateDisplayName(clip(rawName, DISPLAY_NAME_MAX));
  if (!name.ok) return { ok: false, error: "invalid_display_name", message: name.error };
  const bio = input.bio === undefined ? undefined : cleanBio(input.bio, warnings);
  const avatar = input.avatar_url === undefined ? undefined : image(input.avatar_url, "avatar_url", warnings);
  const banner = input.banner_url === undefined ? undefined : image(input.banner_url, "banner_url", warnings);
  let link = channelUrl(input.channel_id, handle.handle);
  if (input.channel_url) {
    const normalized = normalizeChannelUrl(input.channel_url);
    if (normalized) link = normalized;
    else warnings.push("channel_url_skipped: only https youtube.com channel URLs are kept.");
  }
  const subscribers = input.subscriber_count === undefined ? undefined : input.subscriber_count;
  const now = deps.now();
  const done = (result: "created" | "updated" | "claimed", profileHandle: string, claimed = result === "claimed") => ({
    ok: true as const,
    result,
    handle: profileHandle,
    channel_id: input.channel_id,
    url: `${deps.origin}/u/${profileHandle}`,
    claimed,
    warnings,
  });

  const existing = await creatorByChannel(deps, input.channel_id);
  if (existing) {
    if (isClaimed(existing)) {
      warnings.push("claimed: this creator claimed their profile, so nothing was changed.");
      return done("claimed", existing.handle);
    }
    let nextHandle = existing.handle;
    if (handle.handle !== existing.handle) {
      if (await isHandleAvailable(handle.handle, existing.user_id, deps.db)) nextHandle = handle.handle;
      else warnings.push(`handle_kept: @${handle.handle} is taken, so the profile stays @${existing.handle}.`);
    }
    const write = (profileHandle: string) =>
      runBatch(deps.db, [
        sql`UPDATE profiles SET handle = ${profileHandle}, display_name = ${name.displayName},
              bio = ${bio === undefined ? sql`bio` : bio}, updated_at = ${now}
            WHERE user_id = ${existing.user_id}
              AND EXISTS (SELECT 1 FROM creator_profiles WHERE user_id = ${existing.user_id} AND claimed_at IS NULL)`,
        sql`UPDATE "user" SET name = ${name.displayName}, updated_at = ${now} WHERE id = ${existing.user_id} AND email = ${existing.email}`,
        sql`UPDATE creator_profiles SET channel_handle = ${handle.handle}, channel_url = ${link},
              avatar_url = ${avatar === undefined ? sql`avatar_url` : avatar},
              banner_url = ${banner === undefined ? sql`banner_url` : banner},
              subscriber_count = ${subscribers === undefined ? sql`subscriber_count` : subscribers},
              updated_at = ${now}
            WHERE user_id = ${existing.user_id} AND claimed_at IS NULL`,
      ]);
    try {
      await write(nextHandle);
    } catch (error) {
      // Someone took the handle between the check and the write.
      if (!isUnique(error) || nextHandle === existing.handle) throw error;
      warnings.push(`handle_kept: @${handle.handle} is taken, so the profile stays @${existing.handle}.`);
      nextHandle = existing.handle;
      await write(nextHandle);
    }
    return done("updated", nextHandle);
  }

  const [holder] = await deps.db.all<{ user_id: string; handle: string; channel_id: string | null; claimed_at: number | null; email: string }>(sql`
    SELECT pr.user_id, pr.handle, cp.channel_id, cp.claimed_at, u.email
    FROM profiles pr
    JOIN "user" u ON u.id = pr.user_id
    LEFT JOIN creator_profiles cp ON cp.user_id = pr.user_id
    WHERE lower(pr.handle) = lower(${handle.handle})
    LIMIT 1
  `);
  if (holder) {
    if (holder.channel_id === null) {
      warnings.push(`claimed: @${holder.handle} belongs to a person who signed up, so nothing was created or changed.`);
      return done("claimed", holder.handle);
    }
    if (isClaimed({ claimed_at: holder.claimed_at, email: holder.email })) {
      warnings.push(`claimed: @${holder.handle} is a claimed creator profile, so nothing was changed.`);
      return done("claimed", holder.handle);
    }
    return {
      ok: false,
      error: "handle_taken",
      message: `@${holder.handle} is already the profile for channel ${holder.channel_id}. Update that channel's handle first.`,
    };
  }

  const userId = crypto.randomUUID();
  try {
    await runBatch(deps.db, [
      sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
          VALUES (${userId}, ${name.displayName}, ${unclaimedCreatorEmail(userId)}, 0, ${now}, ${now})`,
      // onboarded_at stays NULL: unclaimed creators are left out of people search and follow suggestions.
      sql`INSERT INTO profiles (user_id, handle, display_name, bio, created_at, updated_at)
          VALUES (${userId}, ${handle.handle}, ${name.displayName}, ${bio ?? null}, ${now}, ${now})`,
      sql`INSERT INTO creator_profiles (user_id, platform, channel_id, channel_handle, channel_url, avatar_url, banner_url,
            subscriber_count, source, claimed_at, created_at, updated_at)
          VALUES (${userId}, 'youtube', ${input.channel_id}, ${handle.handle}, ${link}, ${avatar ?? null}, ${banner ?? null},
            ${subscribers ?? null}, ${source}, NULL, ${now}, ${now})`,
    ]);
  } catch (error) {
    if (!isUnique(error)) throw error;
    return { ok: false, error: "conflict", message: "Another write created this creator or handle at the same moment. Retry this item." };
  }
  return done("created", handle.handle);
}
