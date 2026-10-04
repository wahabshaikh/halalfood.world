/**
 * Rules for the friends feed, reactions and comments.
 *
 * These are pure so the web app and the future mobile app apply the same
 * visibility, blocking and moderation rules. Nothing here can change a place's
 * halal status: a like, a comment or a follower count is taste, not evidence.
 */

export const MAX_COMMENT_LENGTH = 500;
export const FEED_PAGE_SIZE = 20;

export type CommentValidation =
  | { ok: true; body: string }
  | { ok: false; error: string };

export function validateComment(input: unknown): CommentValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const raw = (input as Record<string, unknown>).body;
  if (typeof raw !== "string") return { ok: false, error: "Write a comment." };
  const body = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!body) return { ok: false, error: "Write a comment." };
  if (body.length > MAX_COMMENT_LENGTH)
    return {
      ok: false,
      error: `Comments can be up to ${MAX_COMMENT_LENGTH} characters.`,
    };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body))
    return { ok: false, error: "That comment contains characters we can't show." };
  return { ok: true, body };
}

/**
 * Reports live in `content_reports`, whose `target_type` is limited by a CHECK
 * constraint that cannot be widened without rebuilding the table. A comment
 * report therefore files under the `check-in` target with a prefixed id, which
 * keeps it in the same queue, appeal path and audit log as every other report.
 */
const COMMENT_TARGET_PREFIX = "comment:";

export function commentReportTarget(commentId: string): string {
  return `${COMMENT_TARGET_PREFIX}${commentId}`;
}

/** The comment id inside a report target id, or null for any other target. */
export function parseCommentReportTarget(targetId: string): string | null {
  return targetId.startsWith(COMMENT_TARGET_PREFIX)
    ? targetId.slice(COMMENT_TARGET_PREFIX.length) || null
    : null;
}

export type VisitAudience = {
  viewerId: string | null;
  ownerId: string;
  /** The visit's own visibility. */
  visitVisibility: "public" | "private";
  /** The owner's account-wide "who can see my visits" preference. */
  ownerVisitsVisibility: "public" | "private";
  /** The owner has a private account: only accepted followers see their activity. */
  ownerIsPrivateAccount: boolean;
  /** The viewer is an accepted follower of the owner. */
  viewerFollowsOwner: boolean;
  /** Either side has blocked the other. */
  blocked: boolean;
  /**
   * The owner ticked "Share this visit to my followers' feeds". A visit that
   * was not shared stays the owner's, even when its visibility is public.
   */
  shared: boolean;
  /**
   * The place is still listed. A visit to an unpublished or hidden place is
   * gone for everyone but its owner and moderators. Missing means listed.
   */
  placeListed?: boolean;
  /** The viewer moderates the site and may open any visit. */
  viewerIsModerator?: boolean;
};

/**
 * Can this viewer see this visit, its reactions and its comments? The owner
 * always can. Anyone else, signed in or not, needs all of: the owner shared
 * it (the explicit opt-in), the visit and the owner's visits are public, the
 * place is still listed, no block in either direction, and for a private
 * account an accepted follow. Moderators can open any visit.
 */
export function canViewVisit(audience: VisitAudience): boolean {
  if (audience.viewerId && audience.viewerId === audience.ownerId) return true;
  if (audience.viewerId && audience.viewerIsModerator) return true;
  if (audience.placeListed === false) return false;
  if (audience.blocked) return false;
  if (!audience.shared) return false;
  if (audience.ownerIsPrivateAccount && !audience.viewerFollowsOwner) return false;
  return (
    audience.visitVisibility === "public" &&
    audience.ownerVisitsVisibility === "public"
  );
}

/** Blocking hides both directions, so neither side can read or reply. */
export function canComment(audience: VisitAudience): boolean {
  return audience.viewerId !== null && canViewVisit(audience);
}

/** The owner of the visit, or the comment's author, may remove a comment. */
export function canDeleteComment(input: {
  viewerId: string | null;
  commentAuthorId: string;
  visitOwnerId: string;
}): boolean {
  if (!input.viewerId) return false;
  return (
    input.viewerId === input.commentAuthorId ||
    input.viewerId === input.visitOwnerId
  );
}

export type FeedCursor = { createdAt: number; id: string };

export function encodeFeedCursor(cursor: FeedCursor): string {
  return `${cursor.createdAt}.${cursor.id}`;
}

export function decodeFeedCursor(value: unknown): FeedCursor | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,16})\.([A-Za-z0-9-]{1,64})$/.exec(value);
  if (!match) return null;
  return { createdAt: Number(match[1]), id: match[2] };
}

export type HalalCheckAnswersView = {
  certificate: "seen" | "not-seen" | "unsure" | null;
  alcohol: "none" | "served" | "unsure" | null;
  meat: "hand" | "machine" | "unsure" | null;
};

/**
 * What a diner noticed on a visit, as short phrases. "Not sure" answers say
 * nothing, so they are left out. The wording is always the diner's own
 * observation, never a statement about the place.
 */
export function describeHalalCheck(answers: HalalCheckAnswersView): string[] {
  const lines: string[] = [];
  if (answers.certificate === "seen") lines.push("Saw a halal certificate");
  else if (answers.certificate === "not-seen") lines.push("No certificate on display");
  if (answers.alcohol === "none") lines.push("No alcohol served");
  else if (answers.alcohol === "served") lines.push("Alcohol served");
  if (answers.meat === "hand") lines.push("Staff said hand-slaughtered (zabiha)");
  else if (answers.meat === "machine") lines.push("Staff said machine-slaughtered");
  return lines;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact age for feed cards: "now", "5m", "20h", "3d", "6w", then a date. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const age = Math.max(0, now - timestamp);
  if (age < MINUTE) return "now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}d`;
  if (age < 60 * DAY) return `${Math.floor(age / (7 * DAY))}w`;
  return new Date(timestamp).toISOString().slice(0, 10);
}
