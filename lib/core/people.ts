/**
 * People: handles, names, bios and the follow rule. Nothing here touches halal
 * status; follows and blocks only decide whose checks and lists someone sees.
 */
import { looksLikeEmail } from "./public-identity";

/** 3–30 characters: lowercase letters, numbers, `_` and `.` (spec §4.2). */
export const HANDLE_PATTERN = /^[a-z0-9_.]{3,30}$/;

/** Names that would read as the site itself or as a moderator, or clash with a route. */
export const RESERVED_HANDLES: readonly string[] = [
  "admin",
  "administrator",
  "halalfood",
  "moderator",
  "mod",
  "support",
  "help",
  "team",
  "staff",
  "official",
  "root",
  "system",
  "deleted",
  "me",
  "you",
];

export function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  return handle || null;
}

export type HandleValidation = { ok: true; handle: string } | { ok: false; error: string };

export function validateHandle(value: unknown): HandleValidation {
  const handle = normalizeHandle(value);
  if (!handle || !HANDLE_PATTERN.test(handle))
    return { ok: false, error: "Handles are 3–30 characters: letters, numbers, _ and ." };
  if (/^[._]|[._]$|\.\./.test(handle)) return { ok: false, error: "Handles can’t start or end with _ or ., or repeat dots." };
  if (RESERVED_HANDLES.includes(handle)) return { ok: false, error: "That handle is reserved. Try another." };
  return { ok: true, handle };
}

/** A starting handle from an email's local part: `Sara.K+food@x` → `sara.k`. Never valid-checked against the database. */
export function handleFromEmail(email: string): string {
  const local = email.split("@")[0]?.split("+")[0] ?? "";
  let handle = local
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 24);
  if (handle.length < 3) handle = `${handle}eats`.slice(0, 24);
  if (RESERVED_HANDLES.includes(handle)) handle = `${handle}_eats`;
  return handle;
}

export const DISPLAY_NAME_MAX = 60;

export function validateDisplayName(value: unknown): { ok: true; displayName: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Enter your name." };
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (looksLikeEmail(name)) return { ok: false, error: "Use a name, not an email address." };
  if (name.length > DISPLAY_NAME_MAX) return { ok: false, error: `Names are ${DISPLAY_NAME_MAX} characters or fewer.` };
  return { ok: true, displayName: name };
}

export const BIO_MAX = 160;

export function validateBio(value: unknown): { ok: true; bio: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, bio: null };
  if (typeof value !== "string") return { ok: false, error: "Bio must be text." };
  const bio = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
  if (bio.length > BIO_MAX) return { ok: false, error: `Bios are ${BIO_MAX} characters or fewer.` };
  return { ok: true, bio: bio || null };
}

export type FollowStatus = "pending" | "accepted";

/** How the viewer stands to a profile they are looking at. */
export type Relation = "self" | "following" | "requested" | "none" | "blocked";

export type FollowDecision =
  | { action: "follow"; status: FollowStatus }
  | { action: "noop"; status: FollowStatus }
  | { action: "reject"; reason: "self" | "blocked" };

/**
 * A private account turns a follow into a request; a public one is accepted
 * straight away. A block in either direction refuses without saying who blocked whom.
 */
export function decideFollow(input: {
  followerId: string;
  followeeId: string;
  followeeIsPrivate: boolean;
  blockedEitherWay: boolean;
  existing: FollowStatus | null;
}): FollowDecision {
  if (input.followerId === input.followeeId) return { action: "reject", reason: "self" };
  if (input.blockedEitherWay) return { action: "reject", reason: "blocked" };
  if (input.existing) return { action: "noop", status: input.existing };
  return { action: "follow", status: input.followeeIsPrivate ? "pending" : "accepted" };
}
